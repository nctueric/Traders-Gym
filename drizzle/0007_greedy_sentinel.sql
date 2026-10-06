CREATE TABLE `access_application_history` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`explanation` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `access_applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `access_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`explanation` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`event_id` text NOT NULL,
	FOREIGN KEY (`reviewed_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_applications_google_sub_unique` ON `access_applications` (`google_sub`);--> statement-breakpoint
CREATE INDEX `applications_queue_idx` ON `access_applications` (`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `application_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_sessions_token_hash_unique` ON `application_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `application_session_expiry` ON `application_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `google_link_challenges` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `account_invites` ADD `google_sub` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `provider` text DEFAULT 'google' NOT NULL;
--> statement-breakpoint
UPDATE auth_sessions SET provider = 'password' WHERE id IN (SELECT session_id FROM password_session_credentials);
--> statement-breakpoint
UPDATE auth_sessions SET provider = 'sites' WHERE user_id IN (SELECT user_id FROM sites_trial_identity);
