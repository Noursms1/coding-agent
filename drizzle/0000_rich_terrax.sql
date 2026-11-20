CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`body` text NOT NULL,
	`repo_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`github_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_org_name` ON `repositories` (`org_id`,`full_name`);--> statement-breakpoint
CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`data` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_seq` ON `session_events` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`repo_full_name` text NOT NULL,
	`base_branch` text NOT NULL,
	`branch` text NOT NULL,
	`mode` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`pr_number` integer,
	`pr_url` text,
	`head_sha` text,
	`checks_state` text DEFAULT 'none' NOT NULL,
	`fix_rounds` integer DEFAULT 0 NOT NULL,
	`wake` integer DEFAULT 0 NOT NULL,
	`inbox_seq` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_repo_branch` ON `sessions` (`repo_full_name`,`branch`);--> statement-breakpoint
CREATE INDEX `sessions_org_owner` ON `sessions` (`org_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `staged_files` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`session_id`, `path`)
);
--> statement-breakpoint
CREATE TABLE `transcript` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transcript_session` ON `transcript` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
