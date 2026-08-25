CREATE TABLE `trade_account_snapshots` (
	`account_id` text PRIMARY KEY NOT NULL,
	`account_name` text NOT NULL,
	`dataset_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
