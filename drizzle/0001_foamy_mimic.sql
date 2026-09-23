CREATE TABLE `account_admin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_email` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_events_time_idx` ON `account_admin_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `account_invites` (
	`email` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`picture` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_google_sub_unique` ON `app_users` (`google_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `system_owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`google_sub` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_owner_user_id_unique` ON `system_owner` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `system_owner_google_sub_unique` ON `system_owner` (`google_sub`);--> statement-breakpoint
ALTER TABLE `trade_account_snapshots` ADD `owner_user_id` text REFERENCES app_users(id);--> statement-breakpoint
ALTER TABLE `trade_account_snapshots` ADD `save_mode` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_account_snapshots` ADD `size_bytes` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_owner_unique` ON `trade_account_snapshots` (`owner_user_id`);