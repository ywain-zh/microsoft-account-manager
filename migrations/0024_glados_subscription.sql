ALTER TABLE glados_checkin_accounts ADD COLUMN subscription_url TEXT;
ALTER TABLE glados_checkin_accounts ADD COLUMN expires_at INTEGER;
ALTER TABLE glados_checkin_accounts ADD COLUMN traffic_used_bytes INTEGER;
ALTER TABLE glados_checkin_accounts ADD COLUMN traffic_limit_gb INTEGER;
ALTER TABLE glados_checkin_accounts ADD COLUMN plan_level TEXT;
