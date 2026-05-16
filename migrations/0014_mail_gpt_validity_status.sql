CREATE TABLE IF NOT EXISTS mail_gpt_validity_status (
  service TEXT NOT NULL CHECK (service IN ('microsoft', 'cloud-mail')),
  normalized_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('valid', 'invalid', 'missing')),
  message TEXT,
  sub2api_account_id INTEGER,
  sub2api_account_name TEXT,
  plan_type TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service, normalized_email)
);

CREATE INDEX IF NOT EXISTS idx_mail_gpt_validity_status_status
  ON mail_gpt_validity_status (service, status, updated_at);
