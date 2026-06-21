import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeImportApiKey,
  normalizeImportBaseUrl,
  normalizeSub2ApiImportCandidates,
  parseSub2ApiImportText
} from '../shared/sub2api-import.ts';

test('normalizes Sub2API import URLs before duplicate checks', () => {
  assert.equal(normalizeImportBaseUrl('api.example.com/v1/chat/completions?x=1#hash'), 'https://api.example.com/v1');
  assert.equal(normalizeImportBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
});

test('parses dotenv style base URL and API key', () => {
  const items = parseSub2ApiImportText(`
    OPENAI_BASE_URL=https://api.example.com/v1
    OPENAI_API_KEY=sk-test-1234567890
  `);

  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'valid');
  assert.equal(items[0].baseUrl, 'https://api.example.com/v1');
  assert.equal(items[0].apiKey, 'sk-test-1234567890');
});

test('parses JSON and header style import text', () => {
  const items = parseSub2ApiImportText(`
    {"base_url":"https://one.example.com/v1/models","api_key":"sk-one-1234567890"}

    curl https://two.example.com/v1/chat/completions \\
      -H "Authorization: Bearer sk-two-1234567890"
  `);

  assert.deepEqual(
    items.map((item) => [item.status, item.baseUrl, item.apiKey]),
    [
      ['valid', 'https://one.example.com/v1', 'sk-one-1234567890'],
      ['valid', 'https://two.example.com/v1', 'sk-two-1234567890']
    ]
  );
});

test('marks incomplete and duplicate import candidates', () => {
  const items = normalizeSub2ApiImportCandidates([
    { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1234567890' },
    { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test-1234567890' },
    { baseUrl: 'https://missing-key.example.com/v1' }
  ]);

  assert.equal(items[0].status, 'valid');
  assert.equal(items[1].status, 'invalid');
  assert.match(items[1].message, /重复/);
  assert.equal(items[2].status, 'invalid');
  assert.match(items[2].message, /API Key/);
});

test('strips bearer prefix and masks api keys', () => {
  const item = normalizeSub2ApiImportCandidates([
    { baseUrl: 'https://api.example.com', apiKey: 'Bearer sk-test-abcdef123456' }
  ])[0];

  assert.equal(normalizeImportApiKey('Bearer sk-test-abcdef123456'), 'sk-test-abcdef123456');
  assert.equal(item.apiKey, 'sk-test-abcdef123456');
  assert.equal(item.maskedApiKey, 'sk-t***3456');
});
