ALTER TABLE accounts ADD COLUMN token_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE accounts ADD COLUMN token_message TEXT;
ALTER TABLE accounts ADD COLUMN token_checked_at TEXT;

UPDATE accounts
SET token_status = 'unknown'
WHERE token_status IS NULL;
