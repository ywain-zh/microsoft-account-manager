CREATE TABLE IF NOT EXISTS cloud_mail_account_remarks (
  user_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  remark TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
