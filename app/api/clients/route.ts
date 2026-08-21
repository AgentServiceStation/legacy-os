import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, clients } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";

const DUPLICATE_CREATE_WINDOW_MS = 30_000;
const CLIENT_STATUSES = new Set(["active", "archived", "test"]);

function normalized(value?: string | null) {
  return value?.trim().toLowerCase() || "";
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      displayName?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      preferredChannel?: string;
      notes?: string;
      isTestData?: boolean;
    };

    // Inquiries can arrive before a legal/full name is known. An incomplete
    // identity is valid; never force the owner to invent a surname.
    const firstName = payload.firstName?.trim() || payload.displayName?.trim() || "";
    const lastName = payload.lastName?.trim() || "";
    if (!firstName) {
      return jsonError("A client name or temporary label is required");
    }

    const email = payload.email?.trim() || null;
    const phone = payload.phone?.trim() || null;
    const preferredChannel = payload.preferredChannel?.trim() || "unknown";
    const notes = payload.notes?.trim() || null;
    const status = payload.isTestData ? "test" : "active";
    const actor = actorFrom(request);
    const now = new Date().toISOString();
    const db = getDb();

    // Suppress only rapid exact retries. Legitimate people with similar names
    // can still be created, and a later record is never silently merged.
    const recentRows = await db
      .select()
      .from(clients)
      .where(eq(clients.workspaceId, WORKSPACE_ID))
      .orderBy(desc(clients.createdAt))
      .limit(20);
    const duplicate = recentRows.find((row) => {
      const createdAt = Date.parse(row.createdAt);
      const recent =
        Number.isFinite(createdAt) &&
        Date.now() - createdAt >= 0 &&
        Date.now() - createdAt <= DUPLICATE_CREATE_WINDOW_MS;
      return (
        recent &&
        row.status === status &&
        normalized(row.firstName) === normalized(firstName) &&
        normalized(row.lastName) === normalized(lastName) &&
        normalized(row.email) === normalized(email) &&
        normalized(row.phone) === normalized(phone)
      );
    });
    if (duplicate) {
      return Response.json({
        id: duplicate.id,
        status: "duplicate_suppressed",
        duplicateSuppressed: true,
      });
    }

    const clientId = makeId("cli");
    await db.batch([
      db.insert(clients).values({
        id: clientId,
        workspaceId: WORKSPACE_ID,
        firstName,
        lastName,
        email,
        phone,
        preferredChannel,
        status,
        notes,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "client.created",
        targetType: "client",
        targetId: clientId,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          identityCompleteness: lastName ? "partial_or_full" : "temporary",
          testData: status === "test",
        }),
        occurredAt: now,
      }),
    ]);

    // Test/sandbox records are intentionally stored for QA but must not feed
    // business intelligence or workflow automation as if they were reality.
    if (status !== "test") {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "client_created",
          sourceType: "client",
          sourceId: clientId,
          clientId,
          category: "inquiry",
          signalKey: "client.inquiry_created",
          value: {
            preferredChannel,
            hasEmail: Boolean(email),
            hasPhone: Boolean(phone),
            hasLastName: Boolean(lastName),
            temporaryIdentity: !lastName,
          },
          priority: 80,
        },
        db,
      );
    }

    return Response.json(
      { id: clientId, status: status === "test" ? "test_created" : "created" },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to create client");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      id?: string;
      displayName?: string;
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      preferredChannel?: string | null;
      notes?: string | null;
      status?: string;
    };
    if (!payload.id) return jsonError("Client id is required");
    if (payload.status && !CLIENT_STATUSES.has(payload.status)) {
      return jsonError("Client status is invalid");
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, payload.id),
          eq(clients.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) return jsonError("Client not found", 404);

    const nextFirstName =
      payload.firstName?.trim() || payload.displayName?.trim() || existing.firstName;
    const nextLastName =
      payload.lastName === undefined ? existing.lastName : payload.lastName.trim();
    if (!nextFirstName) return jsonError("Client name cannot be empty");

    const now = new Date().toISOString();
    const actor = actorFrom(request);
    const nextStatus = payload.status ?? existing.status;
    await db.batch([
      db
        .update(clients)
        .set({
          firstName: nextFirstName,
          lastName: nextLastName,
          email:
            payload.email === undefined
              ? existing.email
              : payload.email?.trim() || null,
          phone:
            payload.phone === undefined
              ? existing.phone
              : payload.phone?.trim() || null,
          preferredChannel:
            payload.preferredChannel === undefined
              ? existing.preferredChannel
              : payload.preferredChannel?.trim() || null,
          notes:
            payload.notes === undefined
              ? existing.notes
              : payload.notes?.trim() || null,
          status: nextStatus,
          updatedAt: now,
          archivedAt: nextStatus === "archived" ? now : null,
        })
        .where(
          and(
            eq(clients.id, existing.id),
            eq(clients.workspaceId, WORKSPACE_ID),
          ),
        ),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "client.updated",
        targetType: "client",
        targetId: existing.id,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          priorStatus: existing.status,
          nextStatus,
          identityUpdated:
            nextFirstName !== existing.firstName || nextLastName !== existing.lastName,
        }),
        occurredAt: now,
      }),
    ]);

    return Response.json({ id: existing.id, status: nextStatus });
  } catch (error) {
    return routeError(error, "Unable to update client");
  }
}
