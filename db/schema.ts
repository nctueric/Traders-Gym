import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tradeAccountSnapshots = sqliteTable("trade_account_snapshots", {
  accountId: text("account_id").primaryKey(),
  accountName: text("account_name").notNull(),
  datasetJson: text("dataset_json").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});
