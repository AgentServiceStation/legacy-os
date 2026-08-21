import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { approvals, assets, auditEvents, projects } from "../../../db/schema";
import { makeId, requireOwner, routeError } from "../_lib";
import { captureAutomationSignal } from "../../../lib/automation-engine";

const DEFAULT_WORKSPACE_ID = "legacy-lines";
const decisions = new Set(["approved", "revision", "rejected"]);

export async function POST(request: Request) {
  try {
    await requireOwner(request);
    const payload = (await request.json()) as {
      approvalId?: string;
      decision?: string;
      category?: string;
      subject?: string;
      reason?: string;
      projectId?: string;
      assetId?: string;
      summary?: string;
      riskLevel?: string;
    };

    const actor =
      request.headers.get("oai-authenticated-user-email") ?? "local-preview";
    const now = new Date().toISOString();
    const db = getDb();

    if (!payload.approvalId && payload.projectId && payload.subject?.trim()) {
      const project = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, payload.projectId),
            eq(projects.workspaceId, DEFAULT_WORKSPACE_ID),
          ),
        )
        .get();
      if (!project) {
        return Response.json({ error: "Project not found" }, { status: 404 });
      }

      const category = payload.category || "client_approval";
      let boundAsset:
        | {
            id: string;
            originalName: string;
            sha256: string;
            version: number;
          }
        | undefined;

      if (category === "design") {
        if (!payload.assetId) {
          return Response.json(
            { error: "Select the exact design file before requesting approval" },
            { status: 400 },
          );
        }
        boundAsset = await db
          .select({
            id: assets.id,
            originalName: assets.originalName,
            sha256: assets.sha256,
            version: assets.version,
          })
          .from(assets)
          .where(
            and(
              eq(assets.id, payload.assetId),
              eq(assets.projectId, payload.projectId),
              eq(assets.workspaceId, DEFAULT_WORKSPACE_ID),
            ),
          )
          .get();
        if (!boundAsset) {
          return Response.json(
            { error: "Design file not found for this project" },
            { status: 404 },
          );
        }
      }

      const approvalId = makeId("approval");
      const binding = boundAsset
        ? {
            assetId: boundAsset.id,
            originalName: boundAsset.originalName,
            version: boundAsset.version,
            sha256: boundAsset.sha256,
          }
        : null;
      await db.batch([
        db.insert(approvals).values({
          id: approvalId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          projectId: payload.projectId,
          requestedByType: "owner",
          requestedById: actor,
          category,
          actionType: "review",
          subject: payload.subject.trim(),
          summary: payload.summary?.trim() || "Client review requested.",
          payloadHash: boundAsset?.sha256 || approvalId,
          payloadRedactedJson: JSON.stringify(binding || {}),
          evidenceJson: JSON.stringify(
            binding
              ? [
                  {
                    type: "asset",
                    id: binding.assetId,
                    version: binding.version,
                    sha256: binding.sha256,
                  },
                ]
              : [],
          ),
          riskLevel: payload.riskLevel || "medium",
          reversibility: "reversible",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(auditEvents).values({
          id: makeId("audit"),
          workspaceId: DEFAULT_WORKSPACE_ID,
          actorType: "user",
          actorId: actor,
          action: "approval.requested",
          targetType: "approval",
          targetId: approvalId,
          riskLevel: payload.riskLevel || "medium",
          outcome: "recorded",
          metadataJson: JSON.stringify({
            projectId: payload.projectId,
            assetId: boundAsset?.id || null,
            assetSha256: boundAsset?.sha256 || null,
          }),
          occurredAt: now,
        }),
      ]);
      await captureAutomationSignal(
        {
          workspaceId: DEFAULT_WORKSPACE_ID,
          eventType: "approval_requested",
          sourceType: "approval",
          sourceId: approvalId,
          projectId: payload.projectId,
          category: "approval",
          signalKey: `approval.requested:${category}`,
          value: {
            category,
            riskLevel: payload.riskLevel || "medium",
            status: "pending",
            assetId: boundAsset?.id || null,
            assetVersion: boundAsset?.version || null,
            assetSha256: boundAsset?.sha256 || null,
          },
          priority: 85,
        },
        db,
      );
      return Response.json(
        {
          approvalId,
          status: "pending",
          binding,
        },
        { status: 201 },
      );
    }

    if (
      !payload.approvalId ||
      !payload.decision ||
      !decisions.has(payload.decision)
    ) {
      return Response.json(
        { error: "approvalId and a valid decision are required" },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.id, payload.approvalId),
          eq(approvals.workspaceId, DEFAULT_WORKSPACE_ID),
        ),
      )
      .get();
    if (!existing) {
      return Response.json({ error: "Approval not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return Response.json(
        { error: "This approval has already been decided" },
        { status: 409 },
      );
    }

    await db.batch([
      db
        .update(approvals)
        .set({
          status: payload.decision,
          decisionBy: actor,
          decisionReason: payload.reason ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(approvals.id, payload.approvalId),
            eq(approvals.workspaceId, DEFAULT_WORKSPACE_ID),
          ),
        ),
      db.insert(auditEvents).values({
        id: `audit_${crypto.randomUUID()}`,
        workspaceId: DEFAULT_WORKSPACE_ID,
        actorType: "user",
        actorId: actor,
        action: `approval.${payload.decision}`,
        targetType: "approval",
        targetId: payload.approvalId,
        riskLevel: "medium",
        outcome: "recorded",
        correlationId: null,
        metadataJson: JSON.stringify({
          category: existing.category,
          subject: existing.subject,
          payloadHash: existing.payloadHash,
        }),
      }),
    ]);
    await captureAutomationSignal(
      {
        workspaceId: DEFAULT_WORKSPACE_ID,
        eventType: "approval_decided",
        sourceType: "approval",
        sourceId: existing.id,
        projectId: existing.projectId,
        category: "approval",
        signalKey: `approval.decision:${payload.decision}`,
        value: {
          category: existing.category,
          riskLevel: existing.riskLevel,
          decision: payload.decision,
          payloadHash: existing.payloadHash,
        },
        priority: 80,
      },
      db,
    );

    return Response.json({
      approvalId: payload.approvalId,
      decision: payload.decision,
      decidedAt: now,
      auditRecorded: true,
    });
  } catch (error) {
    return routeError(error, "Unable to record decision");
  }
}
