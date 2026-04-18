ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'manual';

UPDATE accounts
SET auth_type = 'manual'
WHERE auth_type IS NULL OR TRIM(auth_type) = '';
