import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  appointments,
  approvals,
  assets,
  auditEvents,
  clientMessages,
  clients,
  portalInvitations,
  projects,
  projectUpdates,
  workspaces,
} from "../../../db/schema";
import {
  jsonError,
  makeId,
  resolveClientAccess,
  WORKSPACE_ID,
} from "../_lib";
import { captureAutomationSignal } from "../../../lib/automation-engine";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    const access = await resolveClientAccess(request, token);
    if (!access) return jsonError("Portal access is invalid or expired", 401);
    const db = getDb();

    const [workspace, client, projectRows, appointmentRows, messageRows] =
      await Promise.all([
        db
          .select({
            name: workspaces.name,
            timezone: workspaces.timezone,
          })
          .from(workspaces)
          .where(eq(workspaces.id, WORKSPACE_ID))
          .get(),
        db
          .select()
          .from(clients)
          .where(
            and(
              eq(clients.id, access.clientId),
              eq(clients.workspaceId, access.workspaceId),
            ),
          )
          .get(),
        db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.clientId, access.clientId),
              eq(projects.workspaceId, access.workspaceId),
            ),
          )
          .orderBy(desc(projects.updatedAt)),
        db
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.clientId, access.clientId),
              eq(appointments.workspaceId, access.workspaceId),
            ),
          )
          .orderBy(appointments.startsAt),
        db
          .select()
          .from(clientMessages)
          .where(
            and(
              eq(clientMessages.clientId, access.clientId),
              eq(clientMessages.workspaceId, access.workspaceId),
            ),
          )
          .orderBy(clientMessages.createdAt),
      ]);

    if (!client) return jsonError("Client not found", 404);

    const projectIds = projectRows.map((project) => project.id);
    const [approvalRows, assetRows, updateRows] = projectIds.length
      ? await Promise.all([
          db
            .select()
            .from(approvals)
            .where(
              and(
                inArray(approvals.projectId, projectIds),
                eq(approvals.workspaceId, access.workspaceId),
              ),
            )
            .orderBy(desc(approvals.createdAt)),
          // Until explicit owner-side sharing/version binding is implemented,
          // only files the client uploaded themselves cross the portal boundary.
          db
            .select()
            .from(assets)
            .where(
              and(
                inArray(assets.projectId, projectIds),
                eq(assets.workspaceId, access.workspaceId),
                eq(assets.sourceType, "client_upload"),
              ),
            )
            .orderBy(desc(assets.createdAt)),
          db
            .select()
            .from(projectUpdates)
            .where(
              and(
                inArray(projectUpdates.projectId, projectIds),
                eq(projectUpdates.visibility, "client"),
              ),
            )
            .orderBy(desc(projectUpdates.createdAt)),
        ])
      : [[], [], []];

    if (access.invitation) {
      await db
        .update(portalInvitations)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(portalInvitations.id, access.invitation.id));
    }

    // This is an explicit client-facing DTO. Never return raw owner records from
    // this route: studio notes, internal project summaries, next actions, private
    // appointment notes, AI metadata, approval evidence, and other owner-only
    // fields must remain on the owner side of the boundary.
    const publicClient = {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      preferredChannel: client.preferredChannel,
      status: client.status,
      notes: null,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
    const publicProjects = projectRows.map((project) => ({
      id: project.id,
      clientId: project.clientId,
      title: project.title,
      lifecyclePhase: project.lifecyclePhase,
      status: project.status,
      priority: project.priority,
      placement: project.placement,
      sizeDescription: project.sizeDescription,
      styleTagsJson: project.styleTagsJson,
      budgetMinCents: project.budgetMinCents,
      budgetMaxCents: project.budgetMaxCents,
      targetDate: project.targetDate,
      nextAction: null,
      nextActionAt: null,
      summary: null,
      updatedAt: project.updatedAt,
    }));
    const publicAppointments = appointmentRows.map((appointment) => ({
      id: appointment.id,
      clientId: appointment.clientId,
      projectId: appointment.projectId,
      appointmentType: appointment.appointmentType,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      location: appointment.location,
      notes: null,
    }));
    const publicApprovals = approvalRows.map((approval) => ({
      id: approval.id,
      projectId: approval.projectId,
      category: approval.category,
      subject: approval.subject,
      summary: "Review this item and choose approve or request revision.",
      riskLevel: approval.riskLevel,
      status: approval.status,
      decisionReason: approval.decisionReason,
      createdAt: approval.createdAt,
    }));
    const publicAssets = assetRows.map((asset) => ({
      id: asset.id,
      clientId: asset.clientId,
      projectId: asset.projectId,
      originalName: asset.originalName,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      sourceType: asset.sourceType,
      createdAt: asset.createdAt,
    }));

    return Response.json({
      workspace,
      client: publicClient,
      projects: publicProjects,
      appointments: publicAppointments,
      approvals: publicApprovals,
      messages: messageRows,
      assets: publicAssets,
      updates: updateRows,
      access: {
        expiresAt: access.invitation?.expiresAt ?? null,
        hint: access.invitation?.tokenHint ?? "verified-account",
        method: access.invitation ? "invitation" : "account",
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to open client portal",
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      token?: string;
      action?: "message" | "approval";
      projectId?: string;
      body?: string;
      approvalId?: string;
      decision?: "approved" | "revision";
      reason?: string;
    };
    const access = await resolveClientAccess(request, payload.token ?? null);
    if (!access) return jsonError("Portal access is invalid or expired", 401);
    const db = getDb();
    const now = new Date().toISOString();

    if (payload.action === "message") {
      if (!payload.body?.trim()) return jsonError("Message cannot be empty");
      if (payload.projectId) {
        const project = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, payload.projectId),
              eq(projects.clientId, access.clientId),
              eq(projects.workspaceId, access.workspaceId),
            ),
          )
          .get();
        if (!project) return jsonError("Project not found", 404);
      }
      const messageId = makeId("msg");
      await db.batch([
        db.insert(clientMessages).values({
          id: messageId,
          workspaceId: WORKSPACE_ID,
          clientId: access.clientId,
          projectId: payload.projectId || null,
          senderType: "client",
          senderId: access.clientId,
          body: payload.body.trim(),
          status: "sent",
          createdAt: now,
        }),
        db.insert(auditEvents).values({
          id: makeId("audit"),
          workspaceId: WORKSPACE_ID,
          actorType: "client",
          actorId: access.clientId,
          action: "portal.message_sent",
          targetType: "project",
          targetId: payload.projectId || null,
          riskLevel: "low",
          outcome: "succeeded",
          metadataJson: JSON.stringify({ contentCaptured: false }),
          occurredAt: now,
        }),
      ]);
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "client_message_received",
          sourceType: "message",
          sourceId: messageId,
          projectId: payload.projectId || null,
          clientId: access.clientId,
          category: "communication",
          signalKey: "communication.client_message",
          value: {
            direction: "inbound",
            characterCount: payload.body.trim().length,
            contentCaptured: false,
          },
          priority: 90,
        },
        db,
      );
      return Response.json({ id: messageId, status: "sent" }, { status: 201 });
    }

    if (payload.action === "approval") {
      if (
        !payload.approvalId ||
        !["approved", "revision"].includes(payload.decision ?? "")
      ) {
        return jsonError("Approval and decision are required");
      }
      const approval = await db
        .select({
          id: approvals.id,
          projectId: approvals.projectId,
          status: approvals.status,
          clientId: projects.clientId,
        })
        .from(approvals)
        .leftJoin(projects, eq(approvals.projectId, projects.id))
        .where(
          and(
            eq(approvals.id, payload.approvalId),
            eq(approvals.workspaceId, access.workspaceId),
          ),
        )
        .get();
      if (!approval || approval.clientId !== access.clientId) {
        return jsonError("Approval not found", 404);
      }
      if (approval.status !== "pending") {
        return jsonError("This approval has already been decided", 409);
      }
      await db.batch([
        db
          .update(approvals)
          .set({
            status: payload.decision,
            decisionBy: `client:${access.clientId}`,
            decisionReason: payload.reason?.trim() || null,
            decidedAt: now,
            updatedAt: now,
          })
          .where(eq(approvals.id, payload.approvalId)),
        db.insert(auditEvents).values({
          id: makeId("audit"),
          workspaceId: WORKSPACE_ID,
          actorType: "client",
          actorId: access.clientId,
          action: `approval.${payload.decision}`,
          targetType: "approval",
          targetId: payload.approvalId,
          riskLevel: "medium",
          outcome: "succeeded",
          metadataJson: "{}",
          occurredAt: now,
        }),
      ]);
      await captureAutomationSignal(
        {
          workspaceId: WORKSPACE_ID,
          eventType: "approval_decided",
          sourceType: "approval",
          sourceId: approval.id,
          projectId: approval.projectId,
          clientId: access.clientId,
          category: "approval",
          signalKey: `approval.client_decision:${payload.decision}`,
          value: {
            decision: payload.decision,
            decisionBy: "client",
          },
          priority: 95,
        },
        db,
      );
      return Response.json({ status: payload.decision });
    }

    return jsonError("Unsupported portal action");
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to complete portal action",
      500,
    );
  }
}
