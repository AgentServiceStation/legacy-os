import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  appointments,
  auditEvents,
  clients,
  projects,
} from "../../../db/schema";
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

function sameNullableText(left?: string | null, right?: string | null) {
  return (left?.trim() || null) === (right?.trim() || null);
}

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      clientId?: string;
      projectId?: string;
      appointmentType?: string;
      startsAt?: string;
      endsAt?: string;
      location?: string;
      notes?: string;
    };
    if (!payload.clientId || !payload.startsAt) {
      return jsonError("Client and start time are required");
    }

    const now = new Date().toISOString();
    const actor = actorFrom(request);
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

    let project: { id: string; status: string } | undefined;
    if (payload.projectId) {
      project = await db
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(
          and(
            eq(projects.id, payload.projectId),
            eq(projects.workspaceId, WORKSPACE_ID),
            eq(projects.clientId, payload.clientId),
          ),
        )
        .get();
      if (!project) return jsonError("Project not found for this client", 404);
    }

    const appointmentType = payload.appointmentType?.trim() || "session";
    const projectId = payload.projectId || null;
    const endsAtValue = payload.endsAt || null;
    const location = payload.location?.trim() || null;
    const notes = payload.notes?.trim() || null;

    const recentMatch = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, WORKSPACE_ID),
          eq(appointments.clientId, payload.clientId),
          eq(appointments.startsAt, payload.startsAt),
        ),
      )
      .orderBy(desc(appointments.createdAt))
      .get();
    if (recentMatch) {
      const createdAt = Date.parse(recentMatch.createdAt);
      const isRecent =
        Number.isFinite(createdAt) &&
        Date.now() - createdAt >= 0 &&
        Date.now() - createdAt <= DUPLICATE_CREATE_WINDOW_MS;
      const samePayload =
        recentMatch.projectId === projectId &&
        recentMatch.appointmentType === appointmentType &&
        sameNullableText(recentMatch.endsAt, endsAtValue) &&
        sameNullableText(recentMatch.location, location) &&
        sameNullableText(recentMatch.notes, notes);
      if (isRecent && samePayload) {
        return Response.json({
          id: recentMatch.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        });
      }
    }

    const appointmentId = makeId("apt");
    await db.batch([
      db.insert(appointments).values({
        id: appointmentId,
        workspaceId: WORKSPACE_ID,
        clientId: payload.clientId,
        projectId,
        appointmentType,
        startsAt: payload.startsAt,
        endsAt: endsAtValue,
        location,
        notes,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "appointment.scheduled",
        targetType: "appointment",
        targetId: appointmentId,
        riskLevel: "medium",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          startsAt: payload.startsAt,
          testData: client.status === "test" || project?.status === "test",
        }),
        occurredAt: now,
      }),
    ]);

    const isTestData = client.status === "test" || project?.status === "test";
    if (!isTestData) {
      const startsAt = new Date(payload.startsAt);
      const endsAt = payload.endsAt ? new Date(payload.endsAt) : null;
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "appointment_scheduled",
          sourceType: "appointment",
          sourceId: appointmentId,
          projectId,
          clientId: payload.clientId,
          category: "scheduling",
          signalKey: `appointment.${appointmentType}`,
          value: {
            appointmentType,
            startsAt: payload.startsAt,
            durationMinutes:
              endsAt && !Number.isNaN(startsAt.getTime())
                ? Math.max(
                    0,
                    Math.round(
                      (endsAt.getTime() - startsAt.getTime()) / 60_000,
                    ),
                  )
                : null,
            hasLocation: Boolean(location),
          },
          priority: 75,
        },
        db,
      );
    }

    return Response.json(
      {
        id: appointmentId,
        status: isTestData ? "test_scheduled" : "scheduled",
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to schedule appointment");
  }
}
