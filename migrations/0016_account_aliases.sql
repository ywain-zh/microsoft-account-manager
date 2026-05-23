CREATE TABLE IF NOT EXISTS account_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  alias_account TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_aliases_normalized_alias
  ON account_aliases (normalized_alias);

CREATE INDEX IF NOT EXISTS idx_account_aliases_account_id
  ON account_aliases (account_id, id);
