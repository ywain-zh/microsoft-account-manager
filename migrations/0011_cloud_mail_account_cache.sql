CREATE TABLE IF NOT EXISTS cloud_mail_account_cache (
  config_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  receive_email_count INTEGER NOT NULL DEFAULT 0,
  send_email_count INTEGER NOT NULL DEFAULT 0,
  active_time TEXT,
  create_time TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (config_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_mail_account_cache_config_email
  ON cloud_mail_account_cache (config_key, email);

CREATE INDEX IF NOT EXISTS idx_cloud_mail_account_cache_config_created
  ON cloud_mail_account_cache (config_key, create_time);
