DELETE FROM app_settings
WHERE key IN ('stripe_captcha_config', 'stripe_proxy_config');
