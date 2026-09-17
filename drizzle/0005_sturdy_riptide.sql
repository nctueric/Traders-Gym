CREATE TABLE `password_login_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `password_limits_window_idx` ON `password_login_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `password_session_credentials` (
	`session_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
