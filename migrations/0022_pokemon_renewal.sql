CREATE TABLE IF NOT EXISTS pokemon_renewal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  password_data TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  expired_at INTEGER,
  last_status TEXT CHECK (last_status IN ('success', 'skipped', 'failed')),
  last_message TEXT,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS pokemon_renewal_accounts_email_unique
ON pokemon_renewal_accounts (email);

CREATE INDEX IF NOT EXISTS pokemon_renewal_accounts_enabled_idx
ON pokemon_renewal_accounts (enabled);

CREATE TABLE IF NOT EXISTS pokemon_renewal_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  current_account_id INTEGER,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  logs_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  FOREIGN KEY (current_account_id) REFERENCES pokemon_renewal_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pokemon_renewal_runs_started_idx
ON pokemon_renewal_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS pokemon_renewal_runs_status_idx
ON pokemon_renewal_runs (status);

CREATE TABLE IF NOT EXISTS pokemon_renewal_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  account_id INTEGER,
  account_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
  reason_code TEXT NOT NULL,
  message TEXT NOT NULL,
  expired_at_before INTEGER,
  expired_at_after INTEGER,
  trade_no TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES pokemon_renewal_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES pokemon_renewal_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pokemon_renewal_results_run_idx
ON pokemon_renewal_results (run_id, id);

CREATE INDEX IF NOT EXISTS pokemon_renewal_results_account_idx
ON pokemon_renewal_results (account_id, finished_at DESC);
