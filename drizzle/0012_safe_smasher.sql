CREATE TABLE `ledger_recovery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`backup_week` text NOT NULL,
	`source_version` integer NOT NULL,
	`before_version` integer NOT NULL,
	`after_version` integer,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_backup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`week_key` text NOT NULL,
	`source_version` integer NOT NULL,
	`source_object_key` text,
	`dataset_json` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`captured_at` text NOT NULL,
	`completed_at` text,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` text,
	`lease_token` text,
	`error` text,
	`backup_object_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_backup_week` ON `member_backup_jobs` (`user_id`,`week_key`);--> statement-breakpoint
CREATE INDEX `member_backup_pending` ON `member_backup_jobs` (`state`,`lease_until`);--> statement-breakpoint
CREATE TABLE `member_ledger_bindings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_ledger_bindings_account_id_unique` ON `member_ledger_bindings` (`account_id`);--> statement-breakpoint
CREATE TABLE `member_weekly_backups` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`week_key` text NOT NULL,
	`source_version` integer NOT NULL,
	`source_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`captured_at` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `trade_account_snapshots` ADD `archived_at` text;