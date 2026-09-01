CREATE TABLE IF NOT EXISTS dian115_checkin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  cookie_data TEXT NOT NULL,
  checkin_mode TEXT NOT NULL DEFAULT 'normal' CHECK (checkin_mode IN ('normal', 'lucky')),
  checkin_enabled INTEGER NOT NULL DEFAULT 1,
  use_proxy INTEGER NOT NULL DEFAULT 0,
  points INTEGER,
  balance_updated_at INTEGER,
  last_status TEXT CHECK (last_status IN ('success', 'repeat', 'failed')),
  last_message TEXT,
  last_run_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS dian115_checkin_accounts_status_idx
ON dian115_checkin_accounts (status);

CREATE INDEX IF NOT EXISTS dian115_checkin_accounts_checkin_enabled_idx
ON dian115_checkin_accounts (checkin_enabled);

CREATE TABLE IF NOT EXISTS dian115_checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES dian115_checkin_accounts(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduler', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  reward INTEGER,
  reward_note TEXT,
  error_message TEXT,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS dian115_checkin_logs_account_executed_idx
ON dian115_checkin_logs (account_id, executed_at);