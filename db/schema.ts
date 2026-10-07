import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const appUsers = sqliteTable("app_users", {
  id: text("id").primaryKey(), googleSub: text("google_sub").unique(), email: text("email").notNull().unique(),
  name: text("name").notNull(), picture: text("picture").notNull().default(""), status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(), lastLoginAt: text("last_login_at").notNull(),
});
export const systemOwner = sqliteTable("system_owner", {
  id: integer("id").primaryKey(), userId: text("user_id").notNull().unique().references(() => appUsers.id), googleSub: text("google_sub").notNull().unique(),
});
export const accountInvites = sqliteTable("account_invites", {
  googleSub: text("google_sub"), identityKey: text("identity_key"),
  email: text("email").primaryKey(), status: text("status").notNull().default("PENDING"), createdBy: text("created_by").notNull().references(() => appUsers.id),
  createdAt: text("created_at").notNull(), acceptedAt: text("accepted_at"),
});
export const authSessions = sqliteTable("auth_sessions", {
  provider: text("provider").notNull().default("google"),
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull().unique(), userId: text("user_id").notNull().references(() => appUsers.id),
  createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(),
}, table => [index("auth_sessions_user_idx").on(table.userId), index("auth_sessions_expiry_idx").on(table.expiresAt)]);
export const accountAdminEvents = sqliteTable("account_admin_events", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull().references(() => appUsers.id), action: text("action").notNull(),
  targetEmail: text("target_email").notNull(), result: text("result").notNull(), createdAt: text("created_at").notNull(),
}, table => [index("admin_events_time_idx").on(table.createdAt)]);

export const tradeAccountSnapshots = sqliteTable("trade_account_snapshots", {
  accountId: text("account_id").primaryKey(), archivedAt: text("archived_at"),
  accountName: text("account_name").notNull(),
  datasetJson: text("dataset_json").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  ownerUserId: text("owner_user_id").references(() => appUsers.id),
  saveMode: text("save_mode").notNull().default("legacy"),
  sizeBytes: integer("size_bytes"),
  objectKey: text("object_key"), deletedAt: text("deleted_at"),
}, table => [index("snapshot_owner_idx").on(table.ownerUserId)]);

export const snapshotHistory = sqliteTable("snapshot_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerUserId: text("owner_user_id").notNull().references(() => appUsers.id),
  accountId: text("account_id").notNull(), accountName: text("account_name").notNull(),
  version: integer("version").notNull(), createdAt: text("created_at").notNull(),
  datasetJson: text("dataset_json").notNull(), objectKey: text("object_key"),
  sizeBytes: integer("size_bytes").notNull(), pinned: integer("pinned").notNull().default(0),
}, table => [uniqueIndex("history_account_version").on(table.accountId, table.version), index("history_owner_date").on(table.ownerUserId, table.createdAt), index("history_account_day").on(table.accountId,table.createdAt,table.version)]);

// Separate identity binding; never links by email to the Google owner.
export const sitesTrialIdentity = sqliteTable("sites_trial_identity", {
  id: integer("id").primaryKey(), subject: text("subject").notNull().unique(),
  userId: text("user_id").notNull().unique().references(() => appUsers.id),
});

export const passwordLoginLimits = sqliteTable("password_login_limits", {
  key: text("key").primaryKey(), windowStart: integer("window_start").notNull(), attempts: integer("attempts").notNull(),
}, table => [index("password_limits_window_idx").on(table.windowStart)]);
export const passwordSessionCredentials = sqliteTable("password_session_credentials", {
  sessionId: text("session_id").primaryKey().references(() => authSessions.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
});

export const accessApplications = sqliteTable("access_applications", {
  identityKey: text("identity_key"),
  id: text("id").primaryKey(), googleSub: text("google_sub").unique(), email: text("email").notNull(), name: text("name").notNull(),
  explanation: text("explanation").notNull(), status: text("status").notNull().default("PENDING"), revision: integer("revision").notNull().default(1),
  submittedAt: text("submitted_at").notNull(), updatedAt: text("updated_at").notNull(), reviewNote: text("review_note").notNull().default(""),
  reviewedBy: text("reviewed_by").references(() => appUsers.id), reviewedAt: text("reviewed_at"), eventId: text("event_id").notNull(),
}, table => [uniqueIndex("applications_identity_idx").on(table.identityKey), index("applications_queue_idx").on(table.status, table.submittedAt)]);
export const accessApplicationHistory = sqliteTable("access_application_history", {
  id: text("id").primaryKey(), applicationId: text("application_id").notNull().references(() => accessApplications.id),
  revision: integer("revision").notNull(), action: text("action").notNull(), explanation: text("explanation").notNull(),
  note: text("note").notNull().default(""), actorId: text("actor_id").notNull(), createdAt: text("created_at").notNull(),
});
export const applicationSessions = sqliteTable("application_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull().unique(), googleSub: text("google_sub"), identityKey: text("identity_key"),
  email: text("email").notNull(), name: text("name").notNull(), expiresAt: text("expires_at").notNull(),
}, table => [index("application_session_expiry").on(table.expiresAt)]);
export const googleLinkChallenges = sqliteTable("google_link_challenges", {
  tokenHash: text("token_hash").primaryKey(), sessionId: text("session_id").notNull().references(() => authSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => appUsers.id), expiresAt: text("expires_at").notNull(), consumedAt: text("consumed_at"),
});

export const memberPreferences=sqliteTable("member_preferences",{userId:text("user_id").primaryKey().references(()=>appUsers.id),activeAccountId:text("active_account_id"),preferencesJson:text("preferences_json").notNull().default("{}")});
export const emailCredentials=sqliteTable("email_credentials",{userId:text("user_id").primaryKey().references(()=>appUsers.id),passwordHash:text("password_hash").notNull(),verifiedAt:text("verified_at").notNull(),updatedAt:text("updated_at").notNull()});
export const emailTokens=sqliteTable("email_tokens",{tokenHash:text("token_hash").primaryKey(),purpose:text("purpose").notNull(),email:text("email").notNull(),name:text("name").notNull().default(""),userId:text("user_id").references(()=>appUsers.id),sessionId:text("session_id"),expiresAt:text("expires_at").notNull(),consumedAt:text("consumed_at"),claimId:text("claim_id"),createdAt:text("created_at").notNull()},table=>[index("email_tokens_expiry").on(table.expiresAt)]);
export const memberSessionCredentials=sqliteTable("member_session_credentials",{sessionId:text("session_id").primaryKey().references(()=>authSessions.id,{onDelete:"cascade"}),fingerprint:text("fingerprint").notNull()});

export const snapshotObjectGc=sqliteTable("snapshot_object_gc",{
  objectKey:text("object_key").primaryKey(),ownerUserId:text("owner_user_id").notNull(),
  sizeBytes:integer("size_bytes").notNull(),createdAt:text("created_at").notNull(),
});

export const ledgerHomeViews=sqliteTable('ledger_home_views',{
 accountId:text('account_id').primaryKey().references(()=>tradeAccountSnapshots.accountId),ownerUserId:text('owner_user_id').notNull().references(()=>appUsers.id),
 sourceVersion:integer('source_version').notNull(),schemaVersion:integer('schema_version').notNull(),sourceHash:text('source_hash').notNull(),objectKey:text('object_key').notNull().default(''),summaryJson:text('summary_json').notNull(),createdAt:text('created_at').notNull(),
},table=>[index('ledger_home_views_owner').on(table.ownerUserId,table.accountId)]);

export const memberLedgerBindings = sqliteTable('member_ledger_bindings', {
 userId: text('user_id').primaryKey().references(() => appUsers.id),
 accountId: text('account_id').notNull().unique().references(() => tradeAccountSnapshots.accountId),
});
export const memberWeeklyBackups = sqliteTable('member_weekly_backups', {
 userId: text('user_id').primaryKey().references(() => appUsers.id), accountId: text('account_id').notNull(),
 weekKey: text('week_key').notNull(), sourceVersion: integer('source_version').notNull(), sourceHash: text('source_hash').notNull(),
 objectKey: text('object_key').notNull(), sizeBytes: integer('size_bytes').notNull(), scheduledAt: text('scheduled_at').notNull(),
 capturedAt: text('captured_at').notNull(), completedAt: text('completed_at').notNull(),
});
export const memberBackupJobs = sqliteTable('member_backup_jobs', {
 id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => appUsers.id), accountId: text('account_id').notNull(),
 weekKey: text('week_key').notNull(), sourceVersion: integer('source_version').notNull(), sourceObjectKey: text('source_object_key'), datasetJson: text('dataset_json').notNull(),
 scheduledAt: text('scheduled_at').notNull(), capturedAt: text('captured_at').notNull(), completedAt: text('completed_at'),
 state: text('state').notNull(), attempts: integer('attempts').notNull().default(0), leaseUntil: text('lease_until'), leaseToken: text('lease_token'),
 error: text('error'), backupObjectKey: text('backup_object_key'),
}, table => [uniqueIndex('member_backup_week').on(table.userId,table.weekKey),index('member_backup_pending').on(table.state,table.leaseUntil)]);
export const ledgerRecoveryEvents = sqliteTable('ledger_recovery_events', {
 id: text('id').primaryKey(), actorId: text('actor_id').notNull(), targetUserId: text('target_user_id').notNull(), accountId: text('account_id').notNull(),
 backupWeek: text('backup_week').notNull(), sourceVersion: integer('source_version').notNull(), beforeVersion: integer('before_version').notNull(),
 afterVersion: integer('after_version'), result: text('result').notNull(), createdAt: text('created_at').notNull(),
});
