import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { financialEvents } from "../../../db/lifecycle-schema";
import { auditEvents, clients, projects } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";

const EVENT_TYPES = new Set([
  "estimate",
  "quote",
  "deposit_due",
  "deposit_paid",
  "payment",
  "refund",
  "tip",
  "adjustment",
]);
const EVENT_STATUSES = new Set(["pending", "recorded", "void"]);
const REALIZED_TYPES = new Set(["deposit_paid", "payment", "refund", "tip"]);

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return jsonError("Project id is required");
    const db = getDb();
    const rows = await db
      .select()
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.workspaceId, WORKSPACE_ID),
          eq(financialEvents.projectId, projectId),
        ),
      )
      .orderBy(desc(financialEvents.occurredAt));

    const recorded = rows.filter((row) => row.status === "recorded");
    const totals = recorded.reduce(
      (result, row) => {
        if (row.eventType === "deposit_paid" || row.eventType === "payment") {
          result.paidCents += row.amountCents;
        } else if (row.eventType === "tip") {
          result.tipCents += row.amountCents;
        } else if (row.eventType === "refund") {
          result.refundCents += row.amountCents;
        }
        if (row.eventType === "quote") result.latestQuoteCents = row.amountCents;
        if (row.eventType === "estimate") result.latestEstimateCents = row.amountCents;
        return result;
      },
      {
        paidCents: 0,
        tipCents: 0,
        refundCents: 0,
        latestQuoteCents: null as number | null,
        latestEstimateCents: null as number | null,
      },
    );
    return Response.json({
      events: rows,
      totals: {
        ...totals,
        netReceivedCents: totals.paidCents + totals.tipCents - totals.refundCents,
      },
    });
  } catch (error) {
    return routeError(error, "Unable to load project finances");
  }
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      projectId?: string;
      eventType?: string;
      status?: string;
      amountCents?: number;
      amount?: number;
      currency?: string;
      provider?: string;
      externalId?: string;
      idempotencyKey?: string;
      occurredAt?: string;
      note?: string;
    };
    if (!payload.projectId || !payload.eventType || !EVENT_TYPES.has(payload.eventType)) {
      return jsonError("Project and valid financial event type are required");
    }
    const status = payload.status || "recorded";
    if (!EVENT_STATUSES.has(status)) return jsonError("Financial status is invalid");

    const amountCents =
      typeof payload.amountCents === "number"
        ? Math.round(payload.amountCents)
        : typeof payload.amount === "number"
          ? Math.round(payload.amount * 100)
          : NaN;
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      return jsonError("Financial amount must be zero or greater");
    }

    const db = getDb();
    const project = await db
      .select({
        id: projects.id,
        clientId: projects.clientId,
        status: projects.status,
        clientStatus: clients.status,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.id, payload.projectId),
          eq(projects.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!project) return jsonError("Project not found", 404);

    const provider = payload.provider?.trim() || "manual";
    const externalId = payload.externalId?.trim() || null;
    const idempotencyKey =
      payload.idempotencyKey?.trim() ||
      (externalId ? `${provider}:${externalId}` : null);
    if (idempotencyKey) {
      const existing = await db
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(
          and(
            eq(financialEvents.workspaceId, WORKSPACE_ID),
            eq(financialEvents.idempotencyKey, idempotencyKey),
          ),
        )
        .get();
      if (existing) {
        return Response.json({
          id: existing.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        });
      }
    }

    // Manual double taps do not normally have provider IDs. Suppress an exact
    // recent repeat without making two legitimate same-dollar payments impossible.
    if (!idempotencyKey) {
      const recent = await db
        .select()
        .from(financialEvents)
        .where(
          and(
            eq(financialEvents.workspaceId, WORKSPACE_ID),
            eq(financialEvents.projectId, payload.projectId),
            eq(financialEvents.eventType, payload.eventType),
          ),
        )
        .orderBy(desc(financialEvents.createdAt))
        .get();
      if (
        recent &&
        recent.amountCents === amountCents &&
        recent.status === status &&
        Date.now() - Date.parse(recent.createdAt) >= 0 &&
        Date.now() - Date.parse(recent.createdAt) <= 30_000
      ) {
        return Response.json({
          id: recent.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        });
      }
    }

    const id = makeId("fin");
    const now = new Date().toISOString();
    const occurredAt = payload.occurredAt || now;
    const actor = actorFrom(request);
    const currency = (payload.currency?.trim() || "USD").toUpperCase();
    const isTestData = project.status === "test" || project.clientStatus === "test";

    await db.batch([
      db.insert(financialEvents).values({
        id,
        workspaceId: WORKSPACE_ID,
        projectId: payload.projectId,
        clientId: project.clientId,
        eventType: payload.eventType,
        status,
        amountCents,
        currency,
        provider,
        externalId,
        idempotencyKey,
        occurredAt,
        note: payload.note?.trim() || null,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "financial_event.recorded",
        targetType: "financial_event",
        targetId: id,
        riskLevel: "medium",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          projectId: payload.projectId,
          eventType: payload.eventType,
          amountCents,
          currency,
          provider,
          testData: isTestData,
          externalMoneyMoved: false,
        }),
        occurredAt: now,
      }),
    ]);

    if (!isTestData) {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "financial_event_recorded",
          sourceType: "financial_event",
          sourceId: id,
          projectId: payload.projectId,
          clientId: project.clientId,
          category: "finance",
          signalKey: `finance.${payload.eventType}`,
          value: {
            eventType: payload.eventType,
            status,
            amountCents,
            currency,
            realized: status === "recorded" && REALIZED_TYPES.has(payload.eventType),
            provider,
            externalMoneyMoved: false,
          },
          priority: payload.eventType === "deposit_paid" ? 85 : 65,
        },
        db,
      );
    }

    return Response.json(
      {
        id,
        status: "recorded",
        externalMoneyMoved: false,
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to record financial event");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      id?: string;
      status?: string;
      note?: string | null;
    };
    if (!payload.id) return jsonError("Financial event id is required");
    if (payload.status && !EVENT_STATUSES.has(payload.status)) {
      return jsonError("Financial status is invalid");
    }
    const db = getDb();
    const existing = await db
      .select()
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.id, payload.id),
          eq(financialEvents.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) return jsonError("Financial event not found", 404);

    const now = new Date().toISOString();
    await db
      .update(financialEvents)
      .set({
        status: payload.status ?? existing.status,
        note:
          payload.note === undefined
            ? existing.note
            : payload.note?.trim() || null,
        updatedAt: now,
      })
      .where(eq(financialEvents.id, existing.id));

    return Response.json({ id: existing.id, status: "updated" });
  } catch (error) {
    return routeError(error, "Unable to update financial event");
  }
}
