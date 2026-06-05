import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Sub2ApiLongLinkPlan = 'plus' | 'team';
export type Sub2ApiLongLinkType = 'hosted' | 'gopay';
export type Sub2ApiLongLinkCheckoutUiMode = 'hosted' | 'custom' | 'redirect';

export interface Sub2ApiLongLinkConfig {
  proxyPool: string;
}

export interface Sub2ApiLongLinkCheckoutPayload {
  token: string;
  plan: Sub2ApiLongLinkPlan;
  linkType: Sub2ApiLongLinkType;
  checkoutUiMode: Sub2ApiLongLinkCheckoutUiMode;
  country: string;
  currency: string;
  locale: string;
  usePromo: boolean;
  promoCode?: string;
  workspaceName?: string;
  seatQuantity?: number;
  gopayName?: string;
  gopayLine1?: string;
  gopayLine2?: string;
  gopayCity?: string;
  gopayState?: string;
  gopayPostalCode?: string;
}

export interface Sub2ApiLongLinkProxyCheckResult {
  ok: true;
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;
  isp: string;
  loc: string;
  proxyUsed: string;
  direct: boolean;
}

export interface Sub2ApiLongLinkCheckoutResult {
  ok: true;
  url: string;
  chatgptCheckoutUrl: string;
  openaiPayUrl: string;
  stripeHostedUrl: string;
  checkoutUrl: string;
  stripeRedirectUrl: string;
  providerRedirectUrl: string;
  longUrl: string;
  fallback: string;
  providerError: string;
  expectedAmount: number | null;
  linkType: Sub2ApiLongLinkType;
  proxyUsed: string;
  direct: boolean;
  raw: unknown;
}

interface ProxyCandidate {
  original: string;
  display: string;
  server: string;
  username?: string;
  password?: string;
}

interface ProxyEndpoint {
  protocol: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

interface HelperEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const HELPER_FILENAME = 'sub2api-long-link-helper.py';
const HELPER_TIMEOUT_MS = 90000;
const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024 * 4;
const SUPPORTED_PROXY_PROTOCOLS = ['http', 'https', 'socks5h', 'socks5', 'socks4a', 'socks4'] as const;
type SupportedProxyProtocol = (typeof SUPPORTED_PROXY_PROTOCOLS)[number];

export const DEFAULT_SUB2API_LONG_LINK_CONFIG: Sub2ApiLongLinkConfig = {
  proxyPool: ''
};

export function normalizeSub2ApiLongLinkConfig(input: Partial<Sub2ApiLongLinkConfig>): Sub2ApiLongLinkConfig {
  return {
    proxyPool: normalizeProxyPoolText(input.proxyPool)
  };
}

export function normalizeProxyPoolText(value: unknown): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function extractChatGptAccessToken(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
    return text;
  }

  try {
    const candidate = extractAccessTokenFromJsonValue(JSON.parse(text) as unknown);
    if (candidate) {
      return candidate;
    }
  } catch {
    // Fall through to regex extraction.
  }

  return text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? '';
}

export function buildSub2ApiLongLinkCheckoutRequest(
  payload: Sub2ApiLongLinkCheckoutPayload,
  proxy: string
): Record<string, unknown> {
  const linkType = payload.linkType === 'gopay' ? 'gopay' : 'hosted';
  const checkoutUiMode = linkType === 'gopay' ? 'hosted' : normalizeCheckoutUiMode(payload.checkoutUiMode);
  const country = linkType === 'gopay' ? 'ID' : normalizeUpperText(payload.country, 'US');
  const currency = linkType === 'gopay' ? 'IDR' : normalizeUpperText(payload.currency, 'USD');
  return {
    action: 'checkout',
    token: extractChatGptAccessToken(payload.token),
    proxy,
    link_type: linkType,
    plan: payload.plan === 'team' ? 'team' : 'plus',
    checkout_ui_mode: checkoutUiMode,
    country,
    currency,
    locale: normalizeText(payload.locale) || 'en-US',
    accept_language: normalizeAcceptLanguage(payload.locale),
    use_promo: payload.usePromo !== false,
    promo_code: extractPromoCode(payload.promoCode),
    workspace_name: normalizeText(payload.workspaceName),
    seat_quantity: normalizeInteger(payload.seatQuantity, 2, 2, 1000),
    gopay_name: normalizeText(payload.gopayName),
    gopay_line1: normalizeText(payload.gopayLine1),
    gopay_line2: normalizeText(payload.gopayLine2),
    gopay_city: normalizeText(payload.gopayCity),
    gopay_state: normalizeText(payload.gopayState),
    gopay_postal_code: normalizeText(payload.gopayPostalCode)
  };
}

export function normalizeLongLinkProxyCandidates(poolText: string): ProxyCandidate[] {
  const lines = normalizeProxyPoolText(poolText).split('\n').filter(Boolean);
  const candidates: ProxyCandidate[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    for (const candidate of buildProxyCandidates(line)) {
      const key = `${candidate.server}|${candidate.username ?? ''}|${candidate.password ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

export async function checkSub2ApiLongLinkProxy(poolText: string): Promise<Sub2ApiLongLinkProxyCheckResult> {
  const candidates = normalizeLongLinkProxyCandidates(poolText);
  const errors: string[] = [];

  if (candidates.length === 0) {
    return normalizeProxyCheckResponse(await runLongLinkHelper<unknown>({ action: 'proxy_check', proxy: '' }), null);
  }

  for (const candidate of candidates) {
    try {
      return normalizeProxyCheckResponse(
        await runLongLinkHelper<unknown>({ action: 'proxy_check', proxy: candidate.display }),
        candidate
      );
    } catch (error) {
      errors.push(`${maskProxyDisplay(candidate.display)}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(errors[0] || '代理检测失败');
}

export async function createSub2ApiLongLinkCheckout(
  payload: Sub2ApiLongLinkCheckoutPayload,
  poolText: string
): Promise<Sub2ApiLongLinkCheckoutResult> {
  const token = extractChatGptAccessToken(payload.token);
  if (!token) {
    throw new Error('没有识别到 accessToken');
  }

  const candidates = normalizeLongLinkProxyCandidates(poolText);
  const errors: string[] = [];

  if (candidates.length === 0) {
    return normalizeCheckoutResponse(
      await runLongLinkHelper<unknown>(buildSub2ApiLongLinkCheckoutRequest({ ...payload, token }, '')),
      null
    );
  }

  for (const candidate of candidates) {
    try {
      return normalizeCheckoutResponse(
        await runLongLinkHelper<unknown>(buildSub2ApiLongLinkCheckoutRequest({ ...payload, token }, candidate.display)),
        candidate
      );
    } catch (error) {
      errors.push(`${maskProxyDisplay(candidate.display)}: ${getErrorMessage(error, [token])}`);
    }
  }

  throw new Error(errors[0] || '生成长链失败');
}

export function normalizeCheckoutResponse(data: unknown, candidate: ProxyCandidate | null): Sub2ApiLongLinkCheckoutResult {
  if (!data || typeof data !== 'object') {
    throw new Error('ChatGPT 返回不是 JSON 对象');
  }

  const record = data as Record<string, unknown>;
  const sessionId = normalizeText(record.checkout_session_id);
  const processor = normalizeText(record.processor_entity);
  const checkoutUiMode = normalizeCheckoutUiMode(record.checkout_ui_mode);
  const chatgptCheckoutUrl =
    normalizeText(record.chatgpt_checkout_url) ||
    (sessionId && processor ? `https://chatgpt.com/checkout/${processor}/${sessionId}` : '');
  const stripeHostedUrl = normalizeText(record.stripe_hosted_url);
  const checkoutUrl = normalizeText(record.checkout_url);
  const stripeRedirectUrl = normalizeText(record.stripe_redirect_url);
  const providerRedirectUrl = normalizeText(record.provider_redirect_url);
  const longUrl = normalizeText(record.long_url);
  const openaiPayUrl =
    normalizeText(record.openai_payurl) ||
    [normalizeText(record.url), stripeHostedUrl, checkoutUrl].find((value) => value.startsWith('https://pay.openai.com/')) ||
    (checkoutUiMode === 'hosted' && sessionId ? buildOpenAiPayUrl(sessionId) : '') ||
    '';
  const url = [
    providerRedirectUrl,
    longUrl,
    stripeRedirectUrl,
    openaiPayUrl,
    normalizeText(record.url),
    stripeHostedUrl,
    checkoutUrl,
    chatgptCheckoutUrl
  ].find(Boolean) ?? '';

  if (!url) {
    throw new Error('返回中没有可识别的支付长链');
  }

  return {
    ok: true,
    url,
    chatgptCheckoutUrl,
    openaiPayUrl,
    stripeHostedUrl,
    checkoutUrl,
    stripeRedirectUrl,
    providerRedirectUrl,
    longUrl,
    fallback: normalizeText(record.fallback),
    providerError: normalizeText(record.provider_error),
    expectedAmount: normalizeOptionalNumber(record.expected_amount),
    linkType: record.link_type === 'gopay' ? 'gopay' : 'hosted',
    proxyUsed: normalizeText(record.proxy_used) || candidate?.display || '',
    direct: !(normalizeText(record.proxy_used) || candidate),
    raw: record
  };
}

function normalizeProxyCheckResponse(data: unknown, candidate: ProxyCandidate | null): Sub2ApiLongLinkProxyCheckResult {
  if (!data || typeof data !== 'object') {
    throw new Error('IP 检测服务返回异常');
  }

  const record = data as Record<string, unknown>;
  return {
    ok: true,
    ip: normalizeText(record.ip),
    country: normalizeText(record.country),
    countryCode: normalizeText(record.country_code) || normalizeText(record.countryCode),
    region: normalizeText(record.region),
    city: normalizeText(record.city),
    timezone: normalizeText(record.timezone),
    isp: normalizeText(record.isp),
    loc: normalizeText(record.loc),
    proxyUsed: normalizeText(record.proxy_used) || candidate?.display || '',
    direct: !(normalizeText(record.proxy_used) || candidate)
  };
}

async function runLongLinkHelper<T>(payload: Record<string, unknown>): Promise<T> {
  const helperPath = resolveLongLinkHelperPath();
  const python = resolveLongLinkPythonCommand();
  const input = JSON.stringify(payload);

  return await new Promise<T>((resolvePromise, reject) => {
    const child = spawn(python.command, [...python.args, helperPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('长链 helper 执行超时'));
    }, HELPER_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`无法启动长链 Python helper：${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout || '{}') as HelperEnvelope<T>;
        if (!parsed.ok) {
          throw new Error(parsed.error || stderr.trim() || `长链 helper 执行失败 (${code ?? 'unknown'})`);
        }
        resolvePromise(parsed.data as T);
      } catch (error) {
        const message = getErrorMessage(error);
        reject(new Error(getErrorMessage({ message: message || stderr.trim() || stdout.trim() || '长链 helper 返回异常' })));
      }
    });
    child.stdin.end(input, 'utf8');
  });
}

function resolveLongLinkPythonCommand(): { command: string; args: string[] } {
  const configured = normalizeText(process.env.LONG_LINK_PYTHON);
  if (configured) {
    return { command: configured, args: [] };
  }

  if (process.platform === 'win32') {
    return { command: 'py', args: ['-3'] };
  }

  return { command: 'python3', args: [] };
}

function resolveLongLinkHelperPath(): string {
  const configured = normalizeText(process.env.LONG_LINK_HELPER);
  if (configured) {
    return resolve(configured);
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, HELPER_FILENAME),
    join(currentDir, 'runtime', HELPER_FILENAME),
    join(process.cwd(), 'server', 'runtime', HELPER_FILENAME),
    join(process.cwd(), 'build', 'server', 'runtime', HELPER_FILENAME)
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error('找不到长链 Python helper，请确认运行时资产已复制');
  }
  return found;
}

function extractAccessTokenFromJsonValue(value: unknown): string {
  if (typeof value === 'string') {
    const token = value.trim();
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractAccessTokenFromJsonValue(item);
      if (candidate) {
        return candidate;
      }
    }
    return '';
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  for (const key of ['accessToken', 'access_token', 'token']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return extractAccessTokenFromJsonValue(record.data);
}

function buildProxyCandidates(value: string): ProxyCandidate[] {
  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const explicit = parseExplicitProxy(raw);
  if (explicit) {
    return [toProxyCandidate(raw, explicit)];
  }

  const shorthand = parseShorthandProxy(raw);
  if (!shorthand) {
    throw new Error(`代理格式不支持: ${raw}`);
  }

  const protocols = shorthand.protocol === 'auto' ? ['socks5h', 'socks5', 'http', 'https'] : [shorthand.protocol];
  return protocols.map((protocol) => toProxyCandidate(raw, { ...shorthand, protocol }));
}

function parseExplicitProxy(value: string): ProxyEndpoint | null {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(value);
  if (!match) {
    return null;
  }

  const protocol = match[1].toLowerCase();
  if (!isSupportedProxyProtocol(protocol)) {
    throw new Error(`代理协议不支持: ${protocol}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`代理 URL 格式不合法: ${value}`);
  }

  if (!url.hostname || !url.port) {
    throw new Error(`代理必须包含 host 和 port: ${value}`);
  }

  return {
    protocol,
    host: url.hostname,
    port: url.port,
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || '')
  };
}

function parseShorthandProxy(value: string): (ProxyEndpoint & { protocol: string }) | null {
  const parts = value.split(':');
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !isPort(port)) {
      return null;
    }
    return { protocol: 'auto', host, port, username: '', password: '' };
  }

  if (parts.length >= 4) {
    const host = parts[0];
    const port = parts[1];
    const username = parts[2];
    const password = parts.slice(3).join(':');
    if (!host || !isPort(port) || !username || !password) {
      return null;
    }
    return { protocol: 'http', host, port, username, password };
  }

  return null;
}

function toProxyCandidate(original: string, endpoint: ProxyEndpoint): ProxyCandidate {
  const host = endpoint.host.replace(/^\[|\]$/g, '');
  const requestProtocol = endpoint.protocol === 'socks5h' ? 'socks5h' : endpoint.protocol;
  const server = `${requestProtocol}://${host}:${endpoint.port}`;
  const auth = endpoint.username ? `${encodeURIComponent(endpoint.username)}:${encodeURIComponent(endpoint.password)}@` : '';
  const display = `${endpoint.protocol}://${auth}${host}:${endpoint.port}`;
  return {
    original,
    display,
    server,
    username: endpoint.username || undefined,
    password: endpoint.password || undefined
  };
}

function normalizeCheckoutUiMode(value: unknown): Sub2ApiLongLinkCheckoutUiMode {
  return value === 'custom' || value === 'redirect' ? value : 'hosted';
}

function buildOpenAiPayUrl(sessionId: string): string {
  return `https://pay.openai.com/c/pay/${encodeURIComponent(sessionId)}?ui_mode=hosted`;
}

function normalizeAcceptLanguage(value: unknown): string {
  const locale = normalizeText(value) || 'en-US';
  if (locale === 'zh-CN') {
    return 'zh-CN,zh;q=0.9,en;q=0.8';
  }
  if (locale === 'ja-JP') {
    return 'ja-JP,ja;q=0.9,en;q=0.8';
  }
  return `${locale},en;q=0.9`;
}

function extractPromoCode(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return normalizeText(url.searchParams.get('promoCode') || url.searchParams.get('promocode'));
  } catch {
    const match = /promoCode=([^&#\s]+)/i.exec(text);
    return decodeURIComponent(match?.[1] || text).trim();
  }
}

function normalizeUpperText(value: unknown, fallback: string): string {
  return (normalizeText(value) || fallback).toUpperCase();
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function isPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isSupportedProxyProtocol(value: string): value is SupportedProxyProtocol {
  return (SUPPORTED_PROXY_PROTOCOLS as readonly string[]).includes(value);
}

function appendLimited(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_HELPER_OUTPUT_BYTES ? next.slice(-MAX_HELPER_OUTPUT_BYTES) : next;
}

function extractErrorText(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractErrorText(item);
      if (text) {
        return text;
      }
    }
    return '';
  }

  const record = value as Record<string, unknown>;
  for (const key of ['message', 'error_description', 'detail', 'reason', 'error', 'code', 'type']) {
    const text = extractErrorText(record[key]);
    if (text && text !== '[object Object]') {
      return text;
    }
  }

  try {
    const text = JSON.stringify(record);
    return text === '{}' ? '' : text.slice(0, 500);
  } catch {
    return '';
  }
}

function getErrorMessage(error: unknown, secrets: string[] = []): string {
  const raw = extractErrorText(error) || '发生未知错误';
  let message = raw.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer ***');
  for (const secret of secrets) {
    if (secret) {
      message = message.split(secret).join('***');
    }
  }
  return message.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, '$1***$3');
}

function maskProxyDisplay(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/i, '$1***$3');
}
