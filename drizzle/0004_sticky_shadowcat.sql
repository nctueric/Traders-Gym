CREATE TABLE `sites_trial_identity` (
	`id` integer PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_trial_identity_subject_unique` ON `sites_trial_identity` (`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `sites_trial_identity_user_id_unique` ON `sites_trial_identity` (`user_id`);