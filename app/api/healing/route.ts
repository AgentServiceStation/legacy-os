import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { healingRecords, tattooSessions } from "../../../db/lifecycle-schema";
import { assets, auditEvents, clients, projects } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import { captureObservation } from "../../../lib/intelligence-engine";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";

const HEALING_STAGES = new Set([
  "fresh",
  "early_healing",
  "healing",
  "healed",
  "touchup",
]);

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return jsonError("Project id is required");
    const db = getDb();
    const rows = await db
      .select()
      .from(healingRecords)
      .where(
        and(
          eq(healingRecords.workspaceId, WORKSPACE_ID),
          eq(healingRecords.projectId, projectId),
        ),
      )
      .orderBy(desc(healingRecords.observedAt));
    return Response.json({ healing: rows });
  } catch (error) {
    return routeError(error, "Unable to load healing records");
  }
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      projectId?: string;
      sessionId?: string;
      assetId?: string;
      stage?: string;
      observedAt?: string;
      artistAssessment?: string;
      clientFeedback?: string;
      qualityBps?: number;
      touchupRequired?: boolean;
      notes?: string;
    };
    if (!payload.projectId) return jsonError("Project id is required");
    const stage = payload.stage || "fresh";
    if (!HEALING_STAGES.has(stage)) return jsonError("Healing stage is invalid");
    if (
      payload.qualityBps !== undefined &&
      (!Number.isInteger(payload.qualityBps) ||
        payload.qualityBps < 0 ||
        payload.qualityBps > 10_000)
    ) {
      return jsonError("Healing quality must be between 0 and 10000 basis points");
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

    if (payload.sessionId) {
      const session = await db
        .select({ id: tattooSessions.id })
        .from(tattooSessions)
        .where(
          and(
            eq(tattooSessions.id, payload.sessionId),
            eq(tattooSessions.workspaceId, WORKSPACE_ID),
            eq(tattooSessions.projectId, payload.projectId),
          ),
        )
        .get();
      if (!session) return jsonError("Tattoo session not found for this project", 404);
    }

    if (payload.assetId) {
      const asset = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, payload.assetId),
            eq(assets.workspaceId, WORKSPACE_ID),
            eq(assets.projectId, payload.projectId),
          ),
        )
        .get();
      if (!asset) return jsonError("Healing photo not found for this project", 404);
    }

    const observedAt = payload.observedAt || new Date().toISOString();
    const recent = await db
      .select()
      .from(healingRecords)
      .where(
        and(
          eq(healingRecords.workspaceId, WORKSPACE_ID),
          eq(healingRecords.projectId, payload.projectId),
          eq(healingRecords.stage, stage),
          eq(healingRecords.observedAt, observedAt),
        ),
      )
      .get();
    if (recent) {
      return Response.json({
        id: recent.id,
        status: "duplicate_suppressed",
        duplicateSuppressed: true,
      });
    }

    const id = makeId("heal");
    const now = new Date().toISOString();
    const actor = actorFrom(request);
    const isTestData = project.status === "test" || project.clientStatus === "test";
    await db.batch([
      db.insert(healingRecords).values({
        id,
        workspaceId: WORKSPACE_ID,
        projectId: payload.projectId,
        clientId: project.clientId,
        sessionId: payload.sessionId || null,
        assetId: payload.assetId || null,
        stage,
        observedAt,
        artistAssessment: payload.artistAssessment?.trim() || null,
        clientFeedback: payload.clientFeedback?.trim() || null,
        qualityBps: payload.qualityBps ?? null,
        touchupRequired: Boolean(payload.touchupRequired),
        notes: payload.notes?.trim() || null,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "healing_record.created",
        targetType: "healing_record",
        targetId: id,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          projectId: payload.projectId,
          sessionId: payload.sessionId || null,
          stage,
          hasPhoto: Boolean(payload.assetId),
          touchupRequired: Boolean(payload.touchupRequired),
          testData: isTestData,
        }),
        occurredAt: now,
      }),
    ]);

    if (!isTestData) {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "healing_recorded",
          sourceType: "healing_record",
          sourceId: id,
          projectId: payload.projectId,
          clientId: project.clientId,
          category: "healing",
          signalKey: `healing.${stage}`,
          value: {
            stage,
            hasPhoto: Boolean(payload.assetId),
            qualityBps: payload.qualityBps ?? null,
            touchupRequired: Boolean(payload.touchupRequired),
          },
          priority: payload.touchupRequired ? 90 : stage === "healed" ? 80 : 60,
        },
        db,
      );

      // Healing observations are outcome evidence. They become eligible for
      // broader learning only when the project itself later satisfies the
      // learning engine's real-data/completion rules.
      await captureObservation(
        {
          workspaceId: WORKSPACE_ID,
          projectId: payload.projectId,
          clientId: project.clientId,
          sourceType: "healing_record",
          sourceId: id,
          category: "healing",
          signalKey: `healing.outcome:${stage}`,
          value: {
            stage,
            qualityBps: payload.qualityBps ?? null,
            touchupRequired: Boolean(payload.touchupRequired),
            hasPhoto: Boolean(payload.assetId),
          },
          qualityBps: payload.qualityBps ?? 7000,
          occurredAt: observedAt,
        },
        db,
      );
    }

    return Response.json({ id, status: "created", stage }, { status: 201 });
  } catch (error) {
    return routeError(error, "Unable to create healing record");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      id?: string;
      artistAssessment?: string | null;
      clientFeedback?: string | null;
      qualityBps?: number | null;
      touchupRequired?: boolean;
      notes?: string | null;
    };
    if (!payload.id) return jsonError("Healing record id is required");
    if (
      payload.qualityBps !== undefined &&
      payload.qualityBps !== null &&
      (!Number.isInteger(payload.qualityBps) ||
        payload.qualityBps < 0 ||
        payload.qualityBps > 10_000)
    ) {
      return jsonError("Healing quality must be between 0 and 10000 basis points");
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(healingRecords)
      .where(
        and(
          eq(healingRecords.id, payload.id),
          eq(healingRecords.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) return jsonError("Healing record not found", 404);

    await db
      .update(healingRecords)
      .set({
        artistAssessment:
          payload.artistAssessment === undefined
            ? existing.artistAssessment
            : payload.artistAssessment?.trim() || null,
        clientFeedback:
          payload.clientFeedback === undefined
            ? existing.clientFeedback
            : payload.clientFeedback?.trim() || null,
        qualityBps:
          payload.qualityBps === undefined
            ? existing.qualityBps
            : payload.qualityBps,
        touchupRequired:
          payload.touchupRequired === undefined
            ? existing.touchupRequired
            : payload.touchupRequired,
        notes:
          payload.notes === undefined ? existing.notes : payload.notes?.trim() || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(healingRecords.id, existing.id));

    return Response.json({ id: existing.id, status: "updated" });
  } catch (error) {
    return routeError(error, "Unable to update healing record");
  }
}
