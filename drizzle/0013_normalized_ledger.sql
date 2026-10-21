CREATE TABLE `normalized_ledger_state` (
	`account_id` text PRIMARY KEY NOT NULL,
	`storage_mode` text DEFAULT 'shadow' NOT NULL,
	`normalized_version` integer NOT NULL,
	`projection_version` integer DEFAULT 0 NOT NULL,
	`snapshot_version` integer DEFAULT 0 NOT NULL,
	`projection_pending` integer DEFAULT 0 NOT NULL,
	`snapshot_pending` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `normalized_ledger_pending` ON `normalized_ledger_state` (`projection_pending`,`snapshot_pending`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ledger_mutations` (
	`account_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`committed_version` integer NOT NULL,
	`operations_json` text NOT NULL,
	`committed_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `mutation_id`),
	FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_mutation_version` ON `ledger_mutations` (`account_id`,`committed_version`);
--> statement-breakpoint
CREATE INDEX `ledger_mutation_retention` ON `ledger_mutations` (`committed_at`);
--> statement-breakpoint
CREATE TABLE `ledger_change_log` (
	`account_id` text NOT NULL,
	`version` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`operations_json` text NOT NULL,
	`committed_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `version`),
	FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_change_retention` ON `ledger_change_log` (`committed_at`);
--> statement-breakpoint
CREATE TABLE `ledger_documents` (
	`account_id` text NOT NULL,
	`section` text NOT NULL,
	`payload_json` text NOT NULL,
	`updated_version` integer NOT NULL,
	PRIMARY KEY(`account_id`, `section`),
	FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TRIGGER `ledger_mutation_version_guard` BEFORE INSERT ON `ledger_mutations`
WHEN NEW.base_version <> COALESCE((SELECT version FROM trade_account_snapshots WHERE account_id=NEW.account_id), -1)
BEGIN SELECT RAISE(ABORT, 'LEDGER_VERSION_CONFLICT'); END;
--> statement-breakpoint
CREATE TABLE `ledger_accounts` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_fills` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_cash_activities` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_position_plans` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_plan_history` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_cycle_reviews` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_decision_links` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_decision_link_history` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_improvement_experiments` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_strategies` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_strategy_assignments` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE TABLE `ledger_entry_contexts` (`account_id` text NOT NULL,`entity_id` text NOT NULL,`ordinal` integer,`sort_key` text,`symbol` text,`payload_json` text NOT NULL,`updated_version` integer NOT NULL,PRIMARY KEY(`account_id`,`entity_id`),FOREIGN KEY (`account_id`) REFERENCES `trade_account_snapshots`(`account_id`) ON DELETE cascade);
--> statement-breakpoint
CREATE INDEX `ledger_accounts_account_order` ON `ledger_accounts` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_fills_account_order` ON `ledger_fills` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_fills_account_sort` ON `ledger_fills` (`account_id`,`sort_key`);
--> statement-breakpoint
CREATE INDEX `ledger_cash_activities_account_order` ON `ledger_cash_activities` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_cash_activities_account_sort` ON `ledger_cash_activities` (`account_id`,`sort_key`);
--> statement-breakpoint
CREATE INDEX `ledger_position_plans_account_order` ON `ledger_position_plans` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_plan_history_account_order` ON `ledger_plan_history` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_cycle_reviews_account_order` ON `ledger_cycle_reviews` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_decision_links_account_order` ON `ledger_decision_links` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_decision_link_history_account_order` ON `ledger_decision_link_history` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_improvement_experiments_account_order` ON `ledger_improvement_experiments` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_strategies_account_order` ON `ledger_strategies` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_strategy_assignments_account_order` ON `ledger_strategy_assignments` (`account_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `ledger_entry_contexts_account_order` ON `ledger_entry_contexts` (`account_id`,`ordinal`);
