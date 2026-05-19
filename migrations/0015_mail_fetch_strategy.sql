ALTER TABLE accounts ADD COLUMN mail_fetch_provider TEXT;
ALTER TABLE accounts ADD COLUMN mail_fetch_scope TEXT;
ALTER TABLE accounts ADD COLUMN mail_fetch_error_code TEXT;
ALTER TABLE accounts ADD COLUMN mail_fetch_strategy_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_mail_fetch_strategy
  ON accounts (mail_fetch_provider, mail_fetch_scope, mail_fetch_strategy_updated_at);
