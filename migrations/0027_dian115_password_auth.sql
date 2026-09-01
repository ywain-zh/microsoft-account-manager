ALTER TABLE dian115_checkin_accounts ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'cookie' CHECK (credential_type IN ('cookie', 'password'));
ALTER TABLE dian115_checkin_accounts ADD COLUMN email TEXT;
ALTER TABLE dian115_checkin_accounts ADD COLUMN password_data TEXT;