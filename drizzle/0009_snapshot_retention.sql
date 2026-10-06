-- No history is removed by this migration. Activation is a separate release flag.
CREATE TABLE snapshot_object_gc (
 object_key text PRIMARY KEY NOT NULL,
 owner_user_id text NOT NULL,
 size_bytes integer NOT NULL,
 created_at text NOT NULL
);
CREATE INDEX history_account_day ON snapshot_history(account_id,created_at,version);
