CREATE TABLE IF NOT EXISTS pp_sms_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_phone TEXT NOT NULL UNIQUE,
  country_code TEXT,
  phone_number TEXT NOT NULL,
  sms_api TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  last_code TEXT,
  last_message TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pp_sms_items_status
ON pp_sms_items (status);

CREATE INDEX IF NOT EXISTS idx_pp_sms_items_created_at
ON pp_sms_items (created_at DESC);
