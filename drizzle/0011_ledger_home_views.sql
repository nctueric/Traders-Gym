CREATE TABLE ledger_home_views (
 account_id text PRIMARY KEY NOT NULL REFERENCES trade_account_snapshots(account_id),
 owner_user_id text NOT NULL REFERENCES app_users(id),
 source_version integer NOT NULL,
 schema_version integer NOT NULL,
 source_hash text NOT NULL,
 object_key text NOT NULL DEFAULT '',
 summary_json text NOT NULL,
 created_at text NOT NULL
);
CREATE INDEX ledger_home_views_owner ON ledger_home_views(owner_user_id,account_id);
