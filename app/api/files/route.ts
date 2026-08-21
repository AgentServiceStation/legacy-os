import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { assets, auditEvents, projects } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import {
  actorFrom,
  jsonError,
  makeId,
  requireOwner,
  resolveClientAccess,
  routeError,
  sha256,
  WORKSPACE_ID,
} from "../_lib";

type StoredObject = {
  body: BodyInit;
  httpMetadata?: { contentType?: string };
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const projectId = String(form.get("projectId") ?? "");
    const token = String(form.get("token") ?? "");
    if (!(file instanceof File) || !projectId) {
      return jsonError("A file and project are required");
    }
    if (file.size > 25 * 1024 * 1024) {
      return jsonError("Files must be 25 MB or smaller", 413);
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (["exe", "dll", "js", "mjs", "html", "htm", "svg", "bat", "cmd"].includes(extension)) {
      return jsonError("This file type is not permitted", 415);
    }

    const clientAccess = await resolveClientAccess(request, token || null);
    if (!clientAccess) await requireOwner(request);
    const db = getDb();
    const project = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, WORKSPACE_ID),
        ),
      )
      .get();
    if (!project) return jsonError("Project not found", 404);
    if (clientAccess && project.clientId !== clientAccess.clientId) {
      return jsonError("Portal access is invalid or expired", 401);
    }

    const bytes = await file.arrayBuffer();
    const digest = await sha256(bytes);
    const assetId = makeId("asset");
    const storageKey = `${WORKSPACE_ID}/${projectId}/${assetId}/${file.name}`;
    const actor = clientAccess
      ? `client:${clientAccess.clientId}`
      : actorFrom(request);
    const now = new Date().toISOString();

    await env.MEDIA.put(storageKey, bytes, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { originalName: file.name },
    });
    await db.batch([
      db.insert(assets).values({
        id: assetId,
        workspaceId: WORKSPACE_ID,
        projectId,
        clientId: project.clientId,
        storageKey,
        originalName: file.name,
        mediaType: file.type.startsWith("image/") ? "image" : "file",
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        sha256: digest,
        sourceType: clientAccess ? "client_upload" : "owner_upload",
        extractionStatus: "stored",
        createdBy: actor,
        createdAt: now,
      }),
      db.insert(auditEvents).values({
        id: makeId("audit"),
        workspaceId: WORKSPACE_ID,
        actorType: clientAccess ? "client" : "user",
        actorId: actor,
        action: "asset.uploaded",
        targetType: "asset",
        targetId: assetId,
        riskLevel: "low",
        outcome: "succeeded",
        metadataJson: JSON.stringify({
          projectId,
          byteSize: file.size,
          mimeType: file.type,
        }),
        occurredAt: now,
      }),
    ]);
    await captureAutomationSignal(
      {
        workspaceId: WORKSPACE_ID,
        eventType: "asset_uploaded",
        sourceType: "asset",
        sourceId: assetId,
        projectId,
        clientId: project.clientId,
        category: "knowledge",
        signalKey: `asset.uploaded:${file.type || "application/octet-stream"}`,
        value: {
          assetId,
          mediaType: file.type.startsWith("image/") ? "image" : "file",
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          sourceType: clientAccess ? "client_upload" : "owner_upload",
          integrityVerified: true,
        },
        priority: 70,
      },
      db,
    );

    return Response.json(
      { id: assetId, name: file.name, status: "stored" },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, "Unable to upload file");
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    if (!assetId) return jsonError("Asset id is required");
    const db = getDb();
    const row = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, WORKSPACE_ID)))
      .get();
    if (!row) return jsonError("File not found", 404);
    const clientAccess = await resolveClientAccess(request, token);
    if (clientAccess) {
      if (row.clientId !== clientAccess.clientId) {
        return jsonError("Portal access is invalid or expired", 401);
      }
      // Owner uploads are private by default. A later explicit share/version
      // binding flow can expose a specific immutable owner asset to the client.
      if (row.sourceType !== "client_upload") {
        return jsonError("This file has not been shared with the client", 403);
      }
    } else {
      await requireOwner(request);
    }
    const object = (await env.MEDIA.get(row.storageKey)) as StoredObject | null;
    if (!object) return jsonError("File content not found", 404);
    return new Response(object.body, {
      headers: {
        "content-type": row.mimeType,
        "content-disposition": `inline; filename="${row.originalName.replaceAll('"', "")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return routeError(error, "Unable to download file");
  }
}
