import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const appUsers = sqliteTable("app_users", {
  id: text("id").primaryKey(), googleSub: text("google_sub").notNull().unique(), email: text("email").notNull().unique(),
  name: text("name").notNull(), picture: text("picture").notNull().default(""), status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(), lastLoginAt: text("last_login_at").notNull(),
});
export const systemOwner = sqliteTable("system_owner", {
  id: integer("id").primaryKey(), userId: text("user_id").notNull().unique().references(() => appUsers.id), googleSub: text("google_sub").notNull().unique(),
});
export const accountInvites = sqliteTable("account_invites", {
  email: text("email").primaryKey(), status: text("status").notNull().default("PENDING"), createdBy: text("created_by").notNull().references(() => appUsers.id),
  createdAt: text("created_at").notNull(), acceptedAt: text("accepted_at"),
});
export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull().unique(), userId: text("user_id").notNull().references(() => appUsers.id),
  createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(),
}, table => [index("auth_sessions_user_idx").on(table.userId), index("auth_sessions_expiry_idx").on(table.expiresAt)]);
export const accountAdminEvents = sqliteTable("account_admin_events", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull().references(() => appUsers.id), action: text("action").notNull(),
  targetEmail: text("target_email").notNull(), result: text("result").notNull(), createdAt: text("created_at").notNull(),
}, table => [index("admin_events_time_idx").on(table.createdAt)]);

export const tradeAccountSnapshots = sqliteTable("trade_account_snapshots", {
  accountId: text("account_id").primaryKey(),
  accountName: text("account_name").notNull(),
  datasetJson: text("dataset_json").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  ownerUserId: text("owner_user_id").references(() => appUsers.id),
  saveMode: text("save_mode").notNull().default("legacy"),
  sizeBytes: integer("size_bytes"),
  objectKey: text("object_key"),
}, table => [uniqueIndex("snapshot_owner_unique").on(table.ownerUserId)]);
