CREATE TABLE IF NOT EXISTS seven79_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  category TEXT,
  check_expiry_time TEXT,
  check_remaining_time_ms INTEGER,
  card_number TEXT,
  expiry_date TEXT,
  cvv TEXT,
  phone TEXT,
  sms_api TEXT,
  holder_name TEXT,
  address TEXT,
  expires_at TEXT,
  raw_check_json TEXT,
  raw_verify_json TEXT,
  error_message TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seven79_cards_status
ON seven79_cards (status);

CREATE INDEX IF NOT EXISTS idx_seven79_cards_created_at
ON seven79_cards (created_at DESC);
