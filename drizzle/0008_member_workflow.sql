PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `new_app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`picture` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO new_app_users SELECT * FROM app_users;
--> statement-breakpoint
DROP TABLE app_users;
--> statement-breakpoint
ALTER TABLE new_app_users RENAME TO app_users;
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_google_sub_unique` ON `app_users` (`google_sub`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);
--> statement-breakpoint
CREATE TABLE `new_access_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text,
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
INSERT INTO new_access_applications SELECT * FROM access_applications;
--> statement-breakpoint
DROP TABLE access_applications;
--> statement-breakpoint
ALTER TABLE new_access_applications RENAME TO access_applications;
--> statement-breakpoint
CREATE UNIQUE INDEX `access_applications_google_sub_unique` ON `access_applications` (`google_sub`);
--> statement-breakpoint
CREATE INDEX `applications_queue_idx` ON `access_applications` (`status`,`submitted_at`);
--> statement-breakpoint
CREATE TABLE `new_application_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`google_sub` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO new_application_sessions SELECT * FROM application_sessions;
--> statement-breakpoint
DROP TABLE application_sessions;
--> statement-breakpoint
ALTER TABLE new_application_sessions RENAME TO application_sessions;
--> statement-breakpoint
CREATE UNIQUE INDEX `application_sessions_token_hash_unique` ON `application_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `application_session_expiry` ON `application_sessions` (`expires_at`);
--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
ALTER TABLE access_applications ADD identity_key TEXT;
--> statement-breakpoint
UPDATE access_applications SET identity_key='google:'||google_sub;
--> statement-breakpoint
CREATE UNIQUE INDEX applications_identity_idx ON access_applications(identity_key);
--> statement-breakpoint
ALTER TABLE application_sessions ADD identity_key TEXT;
--> statement-breakpoint
UPDATE application_sessions SET identity_key='google:'||google_sub;
--> statement-breakpoint
ALTER TABLE account_invites ADD identity_key TEXT;
--> statement-breakpoint
UPDATE account_invites SET identity_key='google:'||google_sub WHERE google_sub IS NOT NULL;
--> statement-breakpoint
ALTER TABLE trade_account_snapshots ADD deleted_at TEXT;
--> statement-breakpoint
CREATE TABLE member_preferences(user_id TEXT PRIMARY KEY REFERENCES app_users(id), active_account_id TEXT);
--> statement-breakpoint
CREATE TABLE email_credentials(user_id TEXT PRIMARY KEY REFERENCES app_users(id), password_hash TEXT NOT NULL, verified_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE email_tokens(token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', user_id TEXT REFERENCES app_users(id), session_id TEXT, expires_at TEXT NOT NULL, consumed_at TEXT, claim_id TEXT, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX email_tokens_expiry ON email_tokens(expires_at);
--> statement-breakpoint
CREATE TABLE member_session_credentials(session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL);
