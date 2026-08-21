import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, clients, projects } from "../../../db/schema";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";
import { captureCompletedProject } from "../../../lib/intelligence-engine";
import { captureAutomationSignal } from "../../../lib/automation-engine";

const DUPLICATE_CREATE_WINDOW_MS = 30_000;
const PROJECT_STATUSES = new Set(["active", "completed", "archived", "test"]);

function normalizeTags(style?: string) {
  return (
    style
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean) ?? []
  );
}

function sameNullableText(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      clientId?: string;
      title?: string;
      placement?: string;
      style?: string;
      summary?: string;
      budgetMin?: number;
      budgetMax?: number;
      targetDate?: string;
      nextAction?: string;
      isTestData?: boolean;
    };
    if (!payload.clientId || !payload.title?.trim()) {
      return jsonError("A client and project title are required");
    }

    const db = getDb();
    const client = await db
      .select({ id: clients.id, status: clients.status })
      .from(clients)
      .where(
        and(
          eq(clients.id, payload.clientId),
          eq(clients.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!client) return jsonError("Client not found", 404);

    const title = payload.title.trim();
    const placement = payload.placement?.trim() || null;
    const styleTags = normalizeTags(payload.style);
    const styleTagsJson = JSON.stringify(styleTags);
    const summary = payload.summary?.trim() || null;
    const budgetMinCents =
      typeof payload.budgetMin === "number"
        ? Math.round(payload.budgetMin * 100)
        : null;
    const budgetMaxCents =
      typeof payload.budgetMax === "number"
        ? Math.round(payload.budgetMax * 100)
        : null;
    const targetDate = payload.targetDate || null;
    const nextAction = payload.nextAction?.trim() || "Complete project intake";
    const status = payload.isTestData || client.status === "test" ? "test" : "active";

    // Mobile double taps, browser retries, and slow network responses must not
    // create a second business record. Suppress only a very recent project
    // whose meaningful creation payload matches exactly; legitimate later work
    // with the same title remains possible.
    const recentMatch = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, WORKSPACE_ID),
          eq(projects.clientId, payload.clientId),
          eq(projects.title, title),
        ),
      )
      .orderBy(desc(projects.createdAt))
      .get();

    if (recentMatch) {
      const createdAtMs = Date.parse(recentMatch.createdAt);
      const isRecent =
        Number.isFinite(createdAtMs) &&
        Date.now() - createdAtMs >= 0 &&
        Date.now() - createdAtMs <= DUPLICATE_CREATE_WINDOW_MS;
      const samePayload =
        recentMatch.status === status &&
        sameNullableText(recentMatch.placement, placement) &&
        recentMatch.styleTagsJson === styleTagsJson &&
        sameNullableText(recentMatch.summary, summary) &&
        recentMatch.budgetMinCents === budgetMinCents &&
        recentMatch.budgetMaxCents === budgetMaxCents &&
        sameNullableText(recentMatch.targetDate, targetDate) &&
        sameNullableText(recentMatch.nextAction, nextAction);

      if (isRecent && samePayload) {
        return Response.json({
          id: recentMatch.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        });
      }
    }

    const projectId = makeId("prj");
    const actor = actorFrom(request);
    const now = new Date().toISOString();
    await db.batch([
      db.insert(projects).values({
        id: projectId,
        workspaceId: WORKSPACE_ID,
        clientId: payload.clientId,
        title,
        lifecyclePhase: "consult",
        status,
        placement,
        styleTagsJson,
        summary,
        budgetMinCents,
        budgetMaxCents,
        targetDate,
        nextAction,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "project.created",
        targetType: "project",
        targetId: projectId,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          clientId: payload.clientId,
          testData: status === "test",
        }),
        occurredAt: now,
      }),
    ]);

    if (status !== "test") {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "project_created",
          projectId,
          clientId: payload.clientId,
          sourceType: "project",
          sourceId: projectId,
          category: "workflow",
          signalKey: "project.created",
          value: {
            lifecyclePhase: "consult",
            placement,
            styleTags,
          },
        },
        db,
      );
    }

    return Response.json(
      { id: projectId, status: status === "test" ? "test_created" : "created" },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to create project");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      id?: string;
      lifecyclePhase?: string;
      status?: string;
      nextAction?: string | null;
      nextActionAt?: string | null;
      summary?: string | null;
    };
    if (!payload.id) return jsonError("Project id is required");
    if (
      payload.lifecyclePhase &&
      ![
        "consult",
        "design",
        "approval",
        "session",
        "healing",
        "complete",
      ].includes(payload.lifecyclePhase)
    ) {
      return jsonError("Lifecycle phase is invalid");
    }
    if (payload.status && !PROJECT_STATUSES.has(payload.status)) {
      return jsonError("Project status is invalid");
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, payload.id),
          eq(projects.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) return jsonError("Project not found", 404);

    const now = new Date().toISOString();
    const actor = actorFrom(request);
    const nextPhase = payload.lifecyclePhase ?? existing.lifecyclePhase;
    const nextStatus =
      payload.status ??
      (existing.status === "test"
        ? "test"
        : nextPhase === "complete"
          ? "completed"
          : existing.status);

    await db.batch([
      db
        .update(projects)
        .set({
          lifecyclePhase: nextPhase,
          status: nextStatus,
          nextAction:
            payload.nextAction === undefined
              ? existing.nextAction
              : payload.nextAction,
          nextActionAt:
            payload.nextActionAt === undefined
              ? existing.nextActionAt
              : payload.nextActionAt,
          summary:
            payload.summary === undefined ? existing.summary : payload.summary,
          updatedAt: now,
          archivedAt: nextStatus === "archived" ? now : null,
        })
        .where(eq(projects.id, existing.id)),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "project.updated",
        targetType: "project",
        targetId: existing.id,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          priorPhase: existing.lifecyclePhase,
          nextPhase,
          priorStatus: existing.status,
          nextStatus,
        }),
        occurredAt: now,
      }),
    ]);

    const isReal = nextStatus !== "test";
    if (
      isReal &&
      nextPhase === "complete" &&
      existing.lifecyclePhase !== "complete"
    ) {
      await captureCompletedProject(WORKSPACE_ID, existing.id, db);
    }
    if (isReal) {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType:
            nextPhase === "complete"
              ? "project_completed"
              : `project_${nextPhase}`,
          projectId: existing.id,
          clientId: existing.clientId,
          sourceType: "project",
          sourceId: existing.id,
          category: "workflow",
          signalKey: `project.phase:${nextPhase}`,
          value: {
            priorPhase: existing.lifecyclePhase,
            nextPhase,
            nextAction: payload.nextAction ?? existing.nextAction,
          },
          priority: nextPhase === "complete" ? 95 : 70,
        },
        db,
      );
    }

    return Response.json({
      id: existing.id,
      status: "updated",
      projectStatus: nextStatus,
      lifecyclePhase: nextPhase,
      learningQueued:
        isReal && nextPhase === "complete" && existing.lifecyclePhase !== "complete",
    });
  } catch (error) {
    return routeError(error, "Unable to update project");
  }
}
