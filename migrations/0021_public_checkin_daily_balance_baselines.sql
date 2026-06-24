CREATE TABLE IF NOT EXISTS public_checkin_daily_balance_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  baseline_balance REAL NOT NULL,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES public_checkin_accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS public_checkin_daily_balance_baselines_account_date_unique
ON public_checkin_daily_balance_baselines (account_id, local_date);

CREATE INDEX IF NOT EXISTS public_checkin_daily_balance_baselines_local_date_idx
ON public_checkin_daily_balance_baselines (local_date);
