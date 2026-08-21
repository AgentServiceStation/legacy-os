import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  aiRuns,
  appointments,
  approvals,
  assets,
  auditEvents,
  clientMessages,
  clients,
  notifications,
  projects,
  users,
  workspaces,
} from "../../../db/schema";
import {
  actorFrom,
  displayNameFrom,
  makeId,
  requireOwner,
  routeError,
  WORKSPACE_ID,
} from "../_lib";
import { runAutomationSweepIfDue } from "../../../lib/automation-engine";

export async function GET(request: Request) {
  try {
    const access = await requireOwner(request);
    const db = getDb();
    const includeTestData =
      new URL(request.url).searchParams.get("includeTestData") === "true";
    const email = access.user!.email || actorFrom(request);
    const displayName = access.user!.displayName || displayNameFrom(request);

    await db
      .insert(workspaces)
      .values({
        id: WORKSPACE_ID,
        name: "Legacy Studio",
        domainType: "tattoo",
        timezone: "America/Los_Angeles",
      })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: makeId("usr"),
        workspaceId: WORKSPACE_ID,
        email,
        displayName,
        role: "owner",
      })
      .onConflictDoUpdate({
        target: [users.workspaceId, users.email],
        set: { displayName, updatedAt: new Date().toISOString() },
      });

    await runAutomationSweepIfDue(
      WORKSPACE_ID,
      "workspace_opened",
      db,
    ).catch(() => null);

    const [
      workspace,
      owner,
      rawClientRows,
      rawProjectRows,
      rawAppointmentRows,
      rawApprovalRows,
      rawMessageRows,
      rawAssetRows,
      rawRunRows,
      auditRows,
      notificationRows,
    ] = await Promise.all([
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, WORKSPACE_ID))
        .get(),
      db
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, email),
            eq(users.workspaceId, WORKSPACE_ID),
          ),
        )
        .get(),
      db
        .select()
        .from(clients)
        .where(eq(clients.workspaceId, WORKSPACE_ID))
        .orderBy(desc(clients.updatedAt)),
      db
        .select({
          id: projects.id,
          clientId: projects.clientId,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          title: projects.title,
          projectType: projects.projectType,
          lifecyclePhase: projects.lifecyclePhase,
          status: projects.status,
          priority: projects.priority,
          placement: projects.placement,
          sizeDescription: projects.sizeDescription,
          styleTagsJson: projects.styleTagsJson,
          budgetMinCents: projects.budgetMinCents,
          budgetMaxCents: projects.budgetMaxCents,
          targetDate: projects.targetDate,
          nextAction: projects.nextAction,
          nextActionAt: projects.nextActionAt,
          summary: projects.summary,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(eq(projects.workspaceId, WORKSPACE_ID))
        .orderBy(desc(projects.updatedAt)),
      db
        .select()
        .from(appointments)
        .where(eq(appointments.workspaceId, WORKSPACE_ID))
        .orderBy(appointments.startsAt),
      db
        .select()
        .from(approvals)
        .where(eq(approvals.workspaceId, WORKSPACE_ID))
        .orderBy(desc(approvals.createdAt)),
      db
        .select()
        .from(clientMessages)
        .where(eq(clientMessages.workspaceId, WORKSPACE_ID))
        .orderBy(desc(clientMessages.createdAt))
        .limit(100),
      db
        .select()
        .from(assets)
        .where(eq(assets.workspaceId, WORKSPACE_ID))
        .orderBy(desc(assets.createdAt))
        .limit(100),
      db
        .select()
        .from(aiRuns)
        .where(eq(aiRuns.workspaceId, WORKSPACE_ID))
        .orderBy(desc(aiRuns.createdAt))
        .limit(50),
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(50),
      db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.workspaceId, WORKSPACE_ID),
            eq(notifications.status, "unread"),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(50),
    ]);

    const clientRows = includeTestData
      ? rawClientRows
      : rawClientRows.filter((client) => client.status !== "test");
    const visibleClientIds = new Set(clientRows.map((client) => client.id));
    const projectRows = includeTestData
      ? rawProjectRows
      : rawProjectRows.filter(
          (project) =>
            project.status !== "test" &&
            (!project.clientId || visibleClientIds.has(project.clientId)),
        );
    const visibleProjectIds = new Set(projectRows.map((project) => project.id));

    const linkedToVisibleReality = (
      clientId: string | null,
      projectId: string | null,
    ) => {
      if (includeTestData) return true;
      if (clientId && !visibleClientIds.has(clientId)) return false;
      if (projectId && !visibleProjectIds.has(projectId)) return false;
      return true;
    };

    const appointmentRows = rawAppointmentRows.filter((row) =>
      linkedToVisibleReality(row.clientId, row.projectId),
    );
    const approvalRows = rawApprovalRows.filter(
      (row) => includeTestData || !row.projectId || visibleProjectIds.has(row.projectId),
    );
    const messageRows = rawMessageRows.filter((row) =>
      linkedToVisibleReality(row.clientId, row.projectId),
    );
    const assetRows = rawAssetRows.filter((row) =>
      linkedToVisibleReality(row.clientId, row.projectId),
    );
    const runRows = rawRunRows.filter(
      (row) => includeTestData || !row.projectId || visibleProjectIds.has(row.projectId),
    );

    return Response.json({
      workspace,
      owner,
      clients: clientRows,
      projects: projectRows,
      appointments: appointmentRows,
      approvals: approvalRows,
      messages: messageRows,
      assets: assetRows,
      aiRuns: runRows,
      auditEvents: auditRows,
      notifications: notificationRows,
      dataPolicy: {
        includeTestData,
        excludedTestClients: rawClientRows.length - clientRows.length,
        excludedTestProjects: rawProjectRows.length - projectRows.length,
      },
    });
  } catch (error) {
    return routeError(error, "Unable to load workspace");
  }
}

export async function PATCH(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      name?: string;
      timezone?: string;
      aiContentCapture?: string;
    };
    const update: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    };
    if (payload.name?.trim()) update.name = payload.name.trim();
    if (payload.timezone?.trim()) update.timezone = payload.timezone.trim();
    if (
      ["metadata_only", "redacted_summaries", "full_content"].includes(
        payload.aiContentCapture ?? "",
      )
    ) {
      update.aiContentCapture = payload.aiContentCapture!;
    }
    const db = getDb();
    await db
      .update(workspaces)
      .set(update)
      .where(eq(workspaces.id, WORKSPACE_ID));
    return Response.json({ status: "saved" });
  } catch (error) {
    return routeError(error, "Unable to save workspace");
  }
}
