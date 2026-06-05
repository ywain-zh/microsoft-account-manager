import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSub2ApiLongLinkCheckoutRequest,
  extractChatGptAccessToken,
  normalizeCheckoutResponse,
  normalizeLongLinkProxyCandidates
} from '../server/runtime/sub2api-long-link.ts';

const token = 'eyJaaa.bbb.ccc';

test('extractChatGptAccessToken accepts session JSON and nested data', () => {
  assert.equal(extractChatGptAccessToken(JSON.stringify({ accessToken: token })), token);
  assert.equal(extractChatGptAccessToken(JSON.stringify({ data: { access_token: token } })), token);
  assert.equal(extractChatGptAccessToken(`prefix ${token} suffix`), token);
});

test('buildSub2ApiLongLinkCheckoutRequest builds hosted payload defaults', () => {
  const request = buildSub2ApiLongLinkCheckoutRequest(
    {
      token,
      plan: 'plus',
      linkType: 'hosted',
      checkoutUiMode: 'custom',
      country: 'de',
      currency: 'eur',
      locale: 'zh-CN',
      usePromo: true
    },
    ''
  );

  assert.deepEqual({
    action: request.action,
    token: request.token,
    link_type: request.link_type,
    checkout_ui_mode: request.checkout_ui_mode,
    country: request.country,
    currency: request.currency,
    accept_language: request.accept_language,
    use_promo: request.use_promo
  }, {
    action: 'checkout',
    token,
    link_type: 'hosted',
    checkout_ui_mode: 'custom',
    country: 'DE',
    currency: 'EUR',
    accept_language: 'zh-CN,zh;q=0.9,en;q=0.8',
    use_promo: true
  });
});

test('buildSub2ApiLongLinkCheckoutRequest forces GoPay to hosted ID/IDR', () => {
  const request = buildSub2ApiLongLinkCheckoutRequest(
    {
      token,
      plan: 'plus',
      linkType: 'gopay',
      checkoutUiMode: 'redirect',
      country: 'US',
      currency: 'USD',
      locale: 'en-US',
      usePromo: false,
      gopayName: 'Budi Santoso'
    },
    'http://user:pass@example.test:8080'
  );

  assert.equal(request.link_type, 'gopay');
  assert.equal(request.checkout_ui_mode, 'hosted');
  assert.equal(request.country, 'ID');
  assert.equal(request.currency, 'IDR');
  assert.equal(request.gopay_name, 'Budi Santoso');
});

test('normalizeCheckoutResponse prefers GoPay provider links and maps snake_case fields', () => {
  const response = normalizeCheckoutResponse(
    {
      link_type: 'gopay',
      checkout_session_id: 'cs_test',
      processor_entity: 'stripe',
      url: 'https://pay.openai.com/c/pay/cs_test',
      stripe_hosted_url: 'https://checkout.stripe.com/c/pay/cs_test',
      stripe_redirect_url: 'https://hooks.stripe.com/redirect',
      provider_redirect_url: 'https://app.midtrans.com/snap/v4/redirection/test',
      expected_amount: 2000,
      proxy_used: 'http://user:pass@example.test:8080'
    },
    null
  );

  assert.equal(response.url, 'https://app.midtrans.com/snap/v4/redirection/test');
  assert.equal(response.linkType, 'gopay');
  assert.equal(response.providerRedirectUrl, 'https://app.midtrans.com/snap/v4/redirection/test');
  assert.equal(response.stripeHostedUrl, 'https://checkout.stripe.com/c/pay/cs_test');
  assert.equal(response.chatgptCheckoutUrl, 'https://chatgpt.com/checkout/stripe/cs_test');
  assert.equal(response.expectedAmount, 2000);
  assert.equal(response.direct, false);
});

test('normalizeCheckoutResponse synthesizes OpenAI Pay URL for hosted checkout sessions', () => {
  const response = normalizeCheckoutResponse(
    {
      link_type: 'hosted',
      checkout_ui_mode: 'hosted',
      checkout_session_id: 'cs_live_123',
      processor_entity: 'openai_llc',
      url: 'https://chatgpt.com/checkout/openai_llc/cs_live_123'
    },
    null
  );

  assert.equal(response.url, 'https://pay.openai.com/c/pay/cs_live_123?ui_mode=hosted');
  assert.equal(response.openaiPayUrl, 'https://pay.openai.com/c/pay/cs_live_123?ui_mode=hosted');
  assert.equal(response.chatgptCheckoutUrl, 'https://chatgpt.com/checkout/openai_llc/cs_live_123');
});

test('normalizeLongLinkProxyCandidates expands shorthand and masks auth-ready display', () => {
  const candidates = normalizeLongLinkProxyCandidates('127.0.0.1:7890\nhost.test:8080:user:pass');
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0]?.display, 'socks5h://127.0.0.1:7890');
  assert.equal(candidates[4]?.display, 'http://user:pass@host.test:8080');
});
