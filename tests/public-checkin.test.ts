import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePublicCheckinRewardAmount,
  publicCheckinTestHooks
} from '../server/runtime/public-checkin.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('normalizes raw headers into a safe Cookie header', () => {
  const cookie = publicCheckinTestHooks.normalizeCookieHeader(`
    Host: example.test
    Cookie: session=abc; theme=dark
    New-Api-User: 42
    cf_clearance=token
  `);

  assert.equal(cookie, 'session=abc; theme=dark; cf_clearance=token');
});

test('extracts New-Api-User from pasted headers', () => {
  assert.equal(
    publicCheckinTestHooks.extractPlatformUserIdFromHeaders('Cookie: a=b\nNew-Api-User: 10086'),
    10086
  );
});

test('normalizes cookie credential with injected platform user id', () => {
  const credential = publicCheckinTestHooks.normalizeCredentialInput({
    type: 'cookie',
    cookie: 'Cookie: session=abc\nNew-Api-User: 77'
  });

  assert.deepEqual(credential, {
    type: 'cookie',
    cookie: 'session=abc',
    platformUserId: 77
  });
});

test('encrypts and decrypts credentials with AES-256-GCM', () => {
  const plaintext = JSON.stringify({ type: 'access_token', accessToken: 'sk-test' });
  const encrypted = publicCheckinTestHooks.encryptCredential(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.equal(publicCheckinTestHooks.decryptCredentialText(encrypted), plaintext);
});

test('parses reward amounts from common CheckinHub messages', () => {
  assert.equal(parsePublicCheckinRewardAmount('签到成功，获得 1,024 点额度'), 1024);
  assert.equal(parsePublicCheckinRewardAmount('reward +3.5'), 3.5);
  assert.equal(parsePublicCheckinRewardAmount('今天已经签到过了'), undefined);
});

test('validates supported cron expressions', () => {
  assert.equal(publicCheckinTestHooks.validateCronExpression('0 8 * * *'), true);
  assert.equal(publicCheckinTestHooks.validateCronExpression('*/15 0-23 * * 1-5'), true);
  assert.equal(publicCheckinTestHooks.validateCronExpression('invalid cron'), false);
});
