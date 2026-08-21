import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  auditEvents,
  clientMessages,
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

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      clientId?: string;
      projectId?: string;
      body?: string;
    };
    if (!payload.clientId || !payload.body?.trim()) {
      return jsonError("Client and message are required");
    }

    const body = payload.body.trim();
    const projectId = payload.projectId || null;
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
    if (projectId) {
      project = await db
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.workspaceId, WORKSPACE_ID),
            eq(projects.clientId, payload.clientId),
          ),
        )
        .get();
      if (!project) return jsonError("Project not found for this client", 404);
    }

    const recentMatch = await db
      .select()
      .from(clientMessages)
      .where(
        and(
          eq(clientMessages.workspaceId, WORKSPACE_ID),
          eq(clientMessages.clientId, payload.clientId),
          eq(clientMessages.senderType, "owner"),
        ),
      )
      .orderBy(desc(clientMessages.createdAt))
      .get();
    if (recentMatch) {
      const createdAt = Date.parse(recentMatch.createdAt);
      const isRecent =
        Number.isFinite(createdAt) &&
        Date.now() - createdAt >= 0 &&
        Date.now() - createdAt <= DUPLICATE_CREATE_WINDOW_MS;
      if (
        isRecent &&
        recentMatch.projectId === projectId &&
        recentMatch.body === body
      ) {
        return Response.json({
          id: recentMatch.id,
          status: "duplicate_suppressed",
          duplicateSuppressed: true,
        });
      }
    }

    const messageId = makeId("msg");
    await db.batch([
      db.insert(clientMessages).values({
        id: messageId,
        workspaceId: WORKSPACE_ID,
        clientId: payload.clientId,
        projectId,
        senderType: "owner",
        senderId: actor,
        body,
        status: "sent",
        createdAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: "client_message.sent",
        targetType: "client",
        targetId: payload.clientId,
        riskLevel: "medium",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          contentCaptured: false,
          testData: client.status === "test" || project?.status === "test",
        }),
        occurredAt: now,
      }),
    ]);

    const isTestData = client.status === "test" || project?.status === "test";
    if (!isTestData) {
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "owner_message_sent",
          sourceType: "message",
          sourceId: messageId,
          projectId,
          clientId: payload.clientId,
          category: "communication",
          signalKey: "communication.owner_message",
          value: {
            direction: "outbound",
            characterCount: body.length,
            contentCaptured: false,
          },
          priority: 55,
        },
        db,
      );
    }

    return Response.json(
      { id: messageId, status: isTestData ? "test_sent" : "sent" },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to send message");
  }
}
