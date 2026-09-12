CREATE TABLE `snapshot_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`account_name` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`dataset_json` text NOT NULL,
	`object_key` text,
	`size_bytes` integer NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_account_version` ON `snapshot_history` (`account_id`,`version`);--> statement-breakpoint
CREATE INDEX `history_owner_date` ON `snapshot_history` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER history_before_snapshot_update BEFORE UPDATE OF version ON trade_account_snapshots
WHEN OLD.owner_user_id IS NOT NULL AND NEW.version > OLD.version
BEGIN
 INSERT OR IGNORE INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned)
 VALUES(OLD.owner_user_id,OLD.account_id,OLD.account_name,OLD.version,OLD.updated_at,OLD.dataset_json,OLD.object_key,COALESCE(OLD.size_bytes,length(CAST(OLD.dataset_json AS BLOB))),
 CASE WHEN NOT EXISTS(SELECT 1 FROM snapshot_history WHERE account_id=OLD.account_id) THEN 1 ELSE 0 END);
END;
--> statement-breakpoint
CREATE TRIGGER history_after_snapshot_update AFTER UPDATE OF version ON trade_account_snapshots
WHEN NEW.owner_user_id IS NOT NULL AND NEW.version > OLD.version
BEGIN
 INSERT OR IGNORE INTO snapshot_history(owner_user_id,account_id,account_name,version,created_at,dataset_json,object_key,size_bytes,pinned)
 VALUES(NEW.owner_user_id,NEW.account_id,NEW.account_name,NEW.version,NEW.updated_at,NEW.dataset_json,NEW.object_key,COALESCE(NEW.size_bytes,length(CAST(NEW.dataset_json AS BLOB))),0);
END;
