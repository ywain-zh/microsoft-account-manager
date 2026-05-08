CREATE TABLE IF NOT EXISTS mail_read_marks (
  service TEXT NOT NULL,
  account TEXT NOT NULL,
  message_id TEXT NOT NULL,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service, account, message_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_read_marks_account
  ON mail_read_marks (service, account, marked_at);
