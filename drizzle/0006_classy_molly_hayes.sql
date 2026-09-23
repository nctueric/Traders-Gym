DROP INDEX `snapshot_owner_unique`;--> statement-breakpoint
CREATE INDEX `snapshot_owner_idx` ON `trade_account_snapshots` (`owner_user_id`);