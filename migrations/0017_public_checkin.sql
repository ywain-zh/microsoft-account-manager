CREATE TABLE IF NOT EXISTS public_checkin_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('new-api', 'one-api', 'onehub')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS public_checkin_sites_url_unique
ON public_checkin_sites (url);

CREATE INDEX IF NOT EXISTS public_checkin_sites_platform_idx
ON public_checkin_sites (platform);

CREATE TABLE IF NOT EXISTS public_checkin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('password', 'access_token', 'cookie')),
  credential_data TEXT NOT NULL,
  balance REAL,
  balance_updated_at INTEGER,
  checkin_enabled INTEGER NOT NULL DEFAULT 1,
  use_proxy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (site_id) REFERENCES public_checkin_sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS public_checkin_accounts_site_id_idx
ON public_checkin_accounts (site_id);

CREATE INDEX IF NOT EXISTS public_checkin_accounts_status_idx
ON public_checkin_accounts (status);

CREATE INDEX IF NOT EXISTS public_checkin_accounts_checkin_enabled_idx
ON public_checkin_accounts (checkin_enabled);

CREATE TABLE IF NOT EXISTS public_checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduler', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  reward REAL,
  reward_note TEXT,
  error_message TEXT,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES public_checkin_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS public_checkin_logs_account_executed_idx
ON public_checkin_logs (account_id, executed_at);

CREATE INDEX IF NOT EXISTS public_checkin_logs_status_idx
ON public_checkin_logs (status);

CREATE INDEX IF NOT EXISTS public_checkin_logs_executed_at_idx
ON public_checkin_logs (executed_at);

CREATE TABLE IF NOT EXISTS public_checkin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
