import { getDb } from "../../../db";
import { auditEvents, clients } from "../../../db/schema";
import { captureAutomationSignal } from "../../../lib/automation-engine";
import { actorFrom, jsonError, makeId, requireOwner, routeError, WORKSPACE_ID } from "../_lib";

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
    };

    // Tattoo inquiries often arrive before a legal/full name is known. Keep the
    // current schema compatible by storing an unknown surname as an empty string,
    // while allowing a temporary/display label in the first-name slot.
    const firstName = payload.firstName?.trim() || payload.displayName?.trim() || "";
    const lastName = payload.lastName?.trim() || "";
    if (!firstName) {
      return jsonError("A client name or temporary label is required");
    }

    const clientId = makeId("cli");
    const actor = actorFrom(request);
    const now = new Date().toISOString();
    const db = getDb();
    await db.batch([
      db.insert(clients).values({
        id: clientId,
        workspaceId: WORKSPACE_ID,
        firstName,
        lastName,
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null,
        preferredChannel: payload.preferredChannel?.trim() || "unknown",
        notes: payload.notes?.trim() || null,
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
        metadataJson: JSON.stringify({ identityCompleteness: lastName ? "partial_or_full" : "temporary" }),
        occurredAt: now,
      }),
    ]);
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
          preferredChannel: payload.preferredChannel?.trim() || "unknown",
          hasEmail: Boolean(payload.email?.trim()),
          hasPhone: Boolean(payload.phone?.trim()),
          hasLastName: Boolean(lastName),
          temporaryIdentity: !lastName,
        },
        priority: 80,
      },
      db,
    );
    return Response.json({ id: clientId, status: "created" }, { status: 201 });
  } catch (error) {
    return routeError(error, "Unable to create client");
  }
}
