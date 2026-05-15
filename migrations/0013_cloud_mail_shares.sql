CREATE TABLE IF NOT EXISTS cloud_mail_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  last_accessed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_mail_shares_active_account
  ON cloud_mail_shares (config_key, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cloud_mail_shares_token_id
  ON cloud_mail_shares (token_id);
