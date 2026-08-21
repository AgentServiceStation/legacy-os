CREATE TABLE `tattoo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text,
	`appointment_id` text,
	`session_number` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` text,
	`ended_at` text,
	`duration_minutes` integer,
	`machine_setup_json` text DEFAULT '[]' NOT NULL,
	`needle_setup_json` text DEFAULT '[]' NOT NULL,
	`ink_setup_json` text DEFAULT '[]' NOT NULL,
	`technique_tags_json` text DEFAULT '[]' NOT NULL,
	`voltage_min_mv` integer,
	`voltage_max_mv` integer,
	`artist_notes` text,
	`client_response` text,
	`fresh_result_notes` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tattoo_sessions_project_number_uq` ON `tattoo_sessions` (`project_id`,`session_number`);
--> statement-breakpoint
CREATE INDEX `tattoo_sessions_workspace_project_idx` ON `tattoo_sessions` (`workspace_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `tattoo_sessions_client_idx` ON `tattoo_sessions` (`client_id`);
--> statement-breakpoint
CREATE INDEX `tattoo_sessions_appointment_idx` ON `tattoo_sessions` (`appointment_id`);
--> statement-breakpoint
CREATE TABLE `financial_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'recorded' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`idempotency_key` text,
	`occurred_at` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `financial_events_workspace_project_idx` ON `financial_events` (`workspace_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `financial_events_client_idx` ON `financial_events` (`client_id`);
--> statement-breakpoint
CREATE INDEX `financial_events_occurred_idx` ON `financial_events` (`workspace_id`,`occurred_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_events_idempotency_uq` ON `financial_events` (`workspace_id`,`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `healing_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text,
	`session_id` text,
	`asset_id` text,
	`stage` text DEFAULT 'fresh' NOT NULL,
	`observed_at` text NOT NULL,
	`artist_assessment` text,
	`client_feedback` text,
	`quality_bps` integer,
	`touchup_required` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `tattoo_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `healing_records_workspace_project_idx` ON `healing_records` (`workspace_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `healing_records_session_idx` ON `healing_records` (`session_id`);
--> statement-breakpoint
CREATE INDEX `healing_records_observed_idx` ON `healing_records` (`workspace_id`,`observed_at`);