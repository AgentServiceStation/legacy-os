import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  appointments,
  assets,
  clients,
  projects,
  workspaces,
} from "./schema";

const timestamp = (name: string) =>
  text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

/**
 * One project may contain multiple tattoo sessions. Structured JSON fields keep
 * the first tattoo implementation expressive without prematurely creating a
 * separate table for every machine, cartridge, ink, wash, or technique.
 * Provenance-rich normalization can happen later in the Craft Intelligence layer.
 */
export const tattooSessions = sqliteTable(
  "tattoo_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    clientId: text("client_id").references(() => clients.id),
    appointmentId: text("appointment_id").references(() => appointments.id),
    sessionNumber: integer("session_number").notNull().default(1),
    status: text("status").notNull().default("planned"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    durationMinutes: integer("duration_minutes"),
    machineSetupJson: text("machine_setup_json").notNull().default("[]"),
    needleSetupJson: text("needle_setup_json").notNull().default("[]"),
    inkSetupJson: text("ink_setup_json").notNull().default("[]"),
    techniqueTagsJson: text("technique_tags_json").notNull().default("[]"),
    voltageMinMv: integer("voltage_min_mv"),
    voltageMaxMv: integer("voltage_max_mv"),
    artistNotes: text("artist_notes"),
    clientResponse: text("client_response"),
    freshResultNotes: text("fresh_result_notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("tattoo_sessions_project_number_uq").on(
      table.projectId,
      table.sessionNumber,
    ),
    index("tattoo_sessions_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("tattoo_sessions_client_idx").on(table.clientId),
    index("tattoo_sessions_appointment_idx").on(table.appointmentId),
  ],
);

/**
 * Budgets and quotes are not revenue. Financial events preserve the actual
 * lifecycle of money so Legacy can distinguish pipeline value from paid money.
 * This table records financial truth; provider execution (for example Stripe)
 * remains a separate approval-gated connector concern.
 */
export const financialEvents = sqliteTable(
  "financial_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    clientId: text("client_id").references(() => clients.id),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("recorded"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    provider: text("provider").notNull().default("manual"),
    externalId: text("external_id"),
    idempotencyKey: text("idempotency_key"),
    occurredAt: text("occurred_at").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("financial_events_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("financial_events_client_idx").on(table.clientId),
    index("financial_events_occurred_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    uniqueIndex("financial_events_idempotency_uq").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
  ],
);

/**
 * Healing is an outcome, not merely a reminder. These records connect later
 * evidence back to a particular project/session and optional photo so Legacy
 * can eventually compare technique conditions with healed results.
 */
export const healingRecords = sqliteTable(
  "healing_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    clientId: text("client_id").references(() => clients.id),
    sessionId: text("session_id").references(() => tattooSessions.id),
    assetId: text("asset_id").references(() => assets.id),
    stage: text("stage").notNull().default("fresh"),
    observedAt: text("observed_at").notNull(),
    artistAssessment: text("artist_assessment"),
    clientFeedback: text("client_feedback"),
    qualityBps: integer("quality_bps"),
    touchupRequired: integer("touchup_required", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("healing_records_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("healing_records_session_idx").on(table.sessionId),
    index("healing_records_observed_idx").on(
      table.workspaceId,
      table.observedAt,
    ),
  ],
);
