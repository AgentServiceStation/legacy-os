import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { tattooSessions } from "../../../db/lifecycle-schema";
import { appointments, auditEvents, clients, projects } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";

const SESSION_STATUSES = new Set(["planned", "in_progress", "completed", "cancelled"]);

function jsonArray(value: unknown) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function voltageMv(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return jsonError("Project id is required");
    const db = getDb();
    const rows = await db
      .select()
      .from(tattooSessions)
      .where(
        and(
          eq(tattooSessions.workspaceId, WORKSPACE_ID),
          eq(tattooSessions.projectId, projectId),
        ),
      )
      .orderBy(tattooSessions.sessionNumber);
    return Response.json({ sessions: rows });
  } catch (error) {
    return routeError(error, "Unable to load tattoo sessions");
  }
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      projectId?: string;
      appointmentId?: string;
      sessionNumber?: number;
      status?: string;
      startedAt?: string;
      endedAt?: string;
      durationMinutes?: number;
      machineSetups?: unknown[];
      needleSetups?: unknown[];
      inkSetups?: unknown[];
      techniques?: unknown[];
      voltageMin?: number;
      voltageMax?: number;
      artistNotes?: string;
      clientResponse?: string;
      freshResultNotes?: string;
    };
    if (!payload.projectId) return jsonError("Project id is required");
    if (payload.status && !SESSION_STATUSES.has(payload.status)) {
      return jsonError("Session status is invalid");
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

    if (payload.appointmentId) {
      const appointment = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, payload.appointmentId),
            eq(appointments.workspaceId, WORKSPACE_ID),
            eq(appointments.projectId, payload.projectId),
          ),
        )
        .get();
      if (!appointment) {
        return jsonError("Appointment not found for this project", 404);
      }
    }

    let sessionNumber = payload.sessionNumber;
    if (!Number.isInteger(sessionNumber) || Number(sessionNumber) < 1) {
      const latest = await db
        .select({ sessionNumber: tattooSessions.sessionNumber })
        .from(tattooSessions)
        .where(
          and(
            eq(tattooSessions.workspaceId, WORKSPACE_ID),
            eq(tattooSessions.projectId, payload.projectId),
          ),
        )
        .orderBy(desc(tattooSessions.sessionNumber))
        .get();
      sessionNumber = (latest?.sessionNumber ?? 0) + 1;
    }

    const existing = await db
      .select({ id: tattooSessions.id })
      .from(tattooSessions)
      .where(
        and(
          eq(tattooSessions.projectId, payload.projectId),
          eq(tattooSessions.sessionNumber, Number(sessionNumber)),
        ),
      )
      .get();
    if (existing) {
      return Response.json(
        {
          id: existing.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        },
        { status: 200 },
      );
    }

    const id = makeId("session");
    const now = new Date().toISOString();
    const actor = actorFrom(request);
    const status = payload.status || "planned";
    const minMv = voltageMv(payload.voltageMin);
    const maxMv = voltageMv(payload.voltageMax);
    if (minMv !== null && maxMv !== null && minMv > maxMv) {
      return jsonError("Minimum voltage cannot exceed maximum voltage");
    }

    await db.batch([
      db.insert(tattooSessions).values({
        id,
        workspaceId: WORKSPACE_ID,
        projectId: payload.projectId,
        clientId: project.clientId,
        appointmentId: payload.appointmentId || null,
        sessionNumber: Number(sessionNumber),
        status,
        startedAt: payload.startedAt || null,
        endedAt: payload.endedAt || null,
        durationMinutes:
          typeof payload.durationMinutes === "number"
            ? Math.max(0, Math.round(payload.durationMinutes))
            : null,
        machineSetupJson: jsonArray(payload.machineSetups),
        needleSetupJson: jsonArray(payload.needleSetups),
        inkSetupJson: jsonArray(payload.inkSetups),
        techniqueTagsJson: jsonArray(payload.techniques),
        voltageMinMv: minMv,
        voltageMaxMv: maxMv,
        artistNotes: payload.artistNotes?.trim() || null,
        clientResponse: payload.clientResponse?.trim() || null,
        freshResultNotes: payload.freshResultNotes?.trim() || null,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "tattoo_session.created",
        targetType: "tattoo_session",
        targetId: id,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          projectId: payload.projectId,
          sessionNumber,
          status,
          testData: project.status === "test" || project.clientStatus === "test",
        }),
        occurredAt: now,
      }),
    ]);

    const isTestData = project.status === "test" || project.clientStatus === "test";
    if (!isTestData) {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "tattoo_session_created",
          sourceType: "tattoo_session",
          sourceId: id,
          projectId: payload.projectId,
          clientId: project.clientId,
          category: "session",
          signalKey: `tattoo.session:${status}`,
          value: {
            sessionNumber,
            status,
            durationMinutes: payload.durationMinutes ?? null,
            machineCount: payload.machineSetups?.length ?? 0,
            needleCount: payload.needleSetups?.length ?? 0,
            techniqueCount: payload.techniques?.length ?? 0,
            voltageMinMv: minMv,
            voltageMaxMv: maxMv,
          },
          priority: status === "in_progress" ? 85 : 65,
        },
        db,
      );
    }

    return Response.json({ id, status: "created", sessionNumber }, { status: 201 });
  } catch (error) {
    return routeError(error, "Unable to create tattoo session");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      id?: string;
      status?: string;
      startedAt?: string | null;
      endedAt?: string | null;
      durationMinutes?: number | null;
      machineSetups?: unknown[];
      needleSetups?: unknown[];
      inkSetups?: unknown[];
      techniques?: unknown[];
      voltageMin?: number | null;
      voltageMax?: number | null;
      artistNotes?: string | null;
      clientResponse?: string | null;
      freshResultNotes?: string | null;
    };
    if (!payload.id) return jsonError("Session id is required");
    if (payload.status && !SESSION_STATUSES.has(payload.status)) {
      return jsonError("Session status is invalid");
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(tattooSessions)
      .where(
        and(
          eq(tattooSessions.id, payload.id),
          eq(tattooSessions.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) return jsonError("Tattoo session not found", 404);

    const minMv =
      payload.voltageMin === undefined
        ? existing.voltageMinMv
        : voltageMv(payload.voltageMin);
    const maxMv =
      payload.voltageMax === undefined
        ? existing.voltageMaxMv
        : voltageMv(payload.voltageMax);
    if (minMv !== null && maxMv !== null && minMv > maxMv) {
      return jsonError("Minimum voltage cannot exceed maximum voltage");
    }

    const now = new Date().toISOString();
    const actor = actorFrom(request);
    await db.batch([
      db
        .update(tattooSessions)
        .set({
          status: payload.status ?? existing.status,
          startedAt:
            payload.startedAt === undefined ? existing.startedAt : payload.startedAt,
          endedAt:
            payload.endedAt === undefined ? existing.endedAt : payload.endedAt,
          durationMinutes:
            payload.durationMinutes === undefined
              ? existing.durationMinutes
              : payload.durationMinutes === null
                ? null
                : Math.max(0, Math.round(payload.durationMinutes)),
          machineSetupJson:
            payload.machineSetups === undefined
              ? existing.machineSetupJson
              : jsonArray(payload.machineSetups),
          needleSetupJson:
            payload.needleSetups === undefined
              ? existing.needleSetupJson
              : jsonArray(payload.needleSetups),
          inkSetupJson:
            payload.inkSetups === undefined
              ? existing.inkSetupJson
              : jsonArray(payload.inkSetups),
          techniqueTagsJson:
            payload.techniques === undefined
              ? existing.techniqueTagsJson
              : jsonArray(payload.techniques),
          voltageMinMv: minMv,
          voltageMaxMv: maxMv,
          artistNotes:
            payload.artistNotes === undefined
              ? existing.artistNotes
              : payload.artistNotes?.trim() || null,
          clientResponse:
            payload.clientResponse === undefined
              ? existing.clientResponse
              : payload.clientResponse?.trim() || null,
          freshResultNotes:
            payload.freshResultNotes === undefined
              ? existing.freshResultNotes
              : payload.freshResultNotes?.trim() || null,
          updatedAt: now,
        })
        .where(eq(tattooSessions.id, existing.id)),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "tattoo_session.updated",
        targetType: "tattoo_session",
        targetId: existing.id,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          projectId: existing.projectId,
          priorStatus: existing.status,
          nextStatus: payload.status ?? existing.status,
        }),
        occurredAt: now,
      }),
    ]);

    return Response.json({ id: existing.id, status: "updated" });
  } catch (error) {
    return routeError(error, "Unable to update tattoo session");
  }
}
