export interface ParsedSub2ApiImportPreviewItem {
  index: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  maskedApiKey: string;
  status: 'valid' | 'invalid';
  message: string;
}

export interface Sub2ApiImportCandidateInput {
  baseUrl?: unknown;
  apiKey?: unknown;
  name?: unknown;
}

const BASE_URL_LABELS = [
  'openai_base_url',
  'api_base_url',
  'api-url',
  'api_url',
  'base-url',
  'base_url',
  'baseurl',
  'url'
] as const;

const API_KEY_LABELS = [
  'openai_api_key',
  'x-api-key',
  'x_api_key',
  'api-key',
  'api_key',
  'apikey',
  'authorization'
] as const;

const URL_TOKEN_REGEX = /https?:\/\/[^\s"'`<>]+/gi;
const WRAPPER_CHARS = `"'"\`[]{}()<>,;`;
const KNOWN_ENDPOINT_SUFFIXES: Array<{ suffix: string; replacement: string }> = [
  { suffix: '/v1/chat/completions', replacement: '/v1' },
  { suffix: '/v1/responses', replacement: '/v1' },
  { suffix: '/v1/embeddings', replacement: '/v1' },
  { suffix: '/v1/images/generations', replacement: '/v1' },
  { suffix: '/v1/audio/speech', replacement: '/v1' },
  { suffix: '/v1/audio/transcriptions', replacement: '/v1' },
  { suffix: '/v1/moderations', replacement: '/v1' },
  { suffix: '/v1/models', replacement: '/v1' },
  { suffix: '/v1beta/models', replacement: '/v1beta' },
  { suffix: '/chat/completions', replacement: '' },
  { suffix: '/responses', replacement: '' },
  { suffix: '/embeddings', replacement: '' },
  { suffix: '/models', replacement: '' }
];

export function parseSub2ApiImportText(input: string): ParsedSub2ApiImportPreviewItem[] {
  const text = normalizeInputText(input);
  if (!text) {
    return [];
  }

  const segments = splitImportSegments(text);
  const previewItems = segments.flatMap((segment) => parseImportSegment(segment));
  return markDuplicatePreviewItems(previewItems);
}

export function normalizeSub2ApiImportCandidates(
  items: Sub2ApiImportCandidateInput[]
): ParsedSub2ApiImportPreviewItem[] {
  return markDuplicatePreviewItems(
    items.map((item, index) => createPreviewItem(index + 1, normalizeImportBaseUrl(item.baseUrl), normalizeImportApiKey(item.apiKey), item.name))
  );
}

export function normalizeImportBaseUrl(value: unknown): string {
  const raw = cleanToken(value);
  if (!raw) {
    return '';
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    url.search = '';
    url.hash = '';
    let pathname = url.pathname.replace(/\/+$/, '');

    for (const item of KNOWN_ENDPOINT_SUFFIXES) {
      if (pathname.toLowerCase().endsWith(item.suffix)) {
        pathname = `${pathname.slice(0, pathname.length - item.suffix.length)}${item.replacement}`;
        break;
      }
    }

    const normalizedPath = pathname.replace(/\/+$/, '');
    return `${url.origin}${normalizedPath === '/' ? '' : normalizedPath}`;
  } catch {
    return raw;
  }
}

export function normalizeImportApiKey(value: unknown): string {
  const raw = cleanToken(value);
  if (!raw) {
    return '';
  }

  return raw.replace(/^bearer\s+/i, '').trim();
}

export function maskImportApiKey(value: string): string {
  const key = value.trim();
  if (!key) {
    return '';
  }

  if (key.length <= 8) {
    return `${key.slice(0, 2)}***${key.slice(-2)}`;
  }

  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

export function isValidImportBaseUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeInputText(input: string): string {
  return String(input ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function splitImportSegments(text: string): string[] {
  const segments = text
    .split(/\n\s*\n|(?:^|\n)\s*(?:---+|===+)\s*(?=\n|$)/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [text];
}

function parseImportSegment(segment: string): ParsedSub2ApiImportPreviewItem[] {
  const baseUrls = uniqueValues([
    ...collectLabeledValues(segment, BASE_URL_LABELS, 'baseUrl'),
    ...collectUrlTokens(segment)
  ]);
  const apiKeys = uniqueValues([
    ...collectLabeledValues(segment, API_KEY_LABELS, 'apiKey'),
    ...collectStandaloneApiKeys(segment)
  ]);

  if (baseUrls.length === 0 && apiKeys.length === 0) {
    return [];
  }

  const alignedPairs = alignImportCandidates(baseUrls, apiKeys);
  return alignedPairs.map((pair, index) => createPreviewItem(index + 1, pair.baseUrl, pair.apiKey));
}

function collectLabeledValues(
  segment: string,
  labels: readonly string[],
  kind: 'baseUrl' | 'apiKey'
): string[] {
  const pattern = labels
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join('|');

  const regex = new RegExp(`(?:^|[\\s,{[(;])["'\`]?(${pattern})["'\`]?\\s*[:=]\\s*`, 'gim');
  const values: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(segment)) !== null) {
    const value = readValueAt(segment, regex.lastIndex, kind);
    const normalized = kind === 'baseUrl' ? normalizeImportBaseUrl(value) : normalizeImportApiKey(value);
    if (normalized) {
      values.push(normalized);
    }
  }

  return values;
}

function readValueAt(segment: string, startIndex: number, kind: 'baseUrl' | 'apiKey'): string {
  let cursor = startIndex;
  while (cursor < segment.length && /\s/.test(segment[cursor] ?? '')) {
    cursor += 1;
  }

  if (/^bearer\s+/i.test(segment.slice(cursor))) {
    cursor += /^bearer\s+/i.exec(segment.slice(cursor))?.[0].length ?? 0;
  }

  const quote = segment[cursor];
  if (quote === '"' || quote === '\'' || quote === '`') {
    let end = cursor + 1;
    while (end < segment.length) {
      if (segment[end] === quote && segment[end - 1] !== '\\') {
        break;
      }
      end += 1;
    }
    return segment.slice(cursor + 1, end);
  }

  let end = cursor;
  while (end < segment.length) {
    const char = segment[end] ?? '';
    if (char === '\n' || char === '\r' || char === ',' || char === ';' || char === '}' || char === ']') {
      break;
    }
    if (/\s/.test(char)) {
      break;
    }
    end += 1;
  }

  const raw = segment.slice(cursor, end);
  if (kind === 'apiKey' && /^bearer\s+/i.test(raw)) {
    return raw.replace(/^bearer\s+/i, '');
  }
  return raw;
}

function collectUrlTokens(segment: string): string[] {
  const matches = segment.match(URL_TOKEN_REGEX) ?? [];
  return matches
    .map((item) => normalizeImportBaseUrl(item))
    .filter(Boolean);
}

function collectStandaloneApiKeys(segment: string): string[] {
  const items: string[] = [];
  const lines = segment
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (isLabeledAssignmentLine(line)) {
      continue;
    }

    const authorizationMatch = /\bBearer\s+([^\s"'`,;]+)/i.exec(line);
    if (authorizationMatch) {
      const value = normalizeImportApiKey(authorizationMatch[1]);
      if (value) {
        items.push(value);
      }
      continue;
    }

    const lineUrls = collectUrlTokens(line);
    if (lineUrls.length > 0) {
      const tokens = line
        .split(/\s+/)
        .map((item) => cleanToken(item))
        .filter(Boolean)
        .filter((item) => !/^https?:\/\//i.test(item))
        .filter((item) => !/^(?:curl|-H|--header|GET|POST|PUT|PATCH|DELETE)$/i.test(item))
        .filter((item) => !BASE_URL_LABELS.some((label) => item.toLowerCase() === label))
        .filter((item) => !API_KEY_LABELS.some((label) => item.toLowerCase() === label));

      const keyTokens = tokens.filter((item) => looksLikeApiKey(item));
      for (const token of keyTokens) {
        items.push(normalizeImportApiKey(token));
      }
      continue;
    }

    const cleaned = normalizeImportApiKey(line);
    if (looksLikeApiKey(cleaned)) {
      items.push(cleaned);
    }
  }

  return uniqueValues(items);
}

function isLabeledAssignmentLine(line: string): boolean {
  const labels = [...BASE_URL_LABELS, ...API_KEY_LABELS].map(escapeRegex).join('|');
  return new RegExp(`^\\s*["'\`]?(${labels})["'\`]?\\s*[:=]`, 'i').test(line);
}

function alignImportCandidates(baseUrls: string[], apiKeys: string[]): Array<{ baseUrl: string; apiKey: string }> {
  if (baseUrls.length === 1 && apiKeys.length > 1) {
    return apiKeys.map((apiKey) => ({
      baseUrl: baseUrls[0],
      apiKey
    }));
  }

  if (apiKeys.length === 1 && baseUrls.length > 1) {
    return baseUrls.map((baseUrl) => ({
      baseUrl,
      apiKey: apiKeys[0]
    }));
  }

  const count = Math.max(baseUrls.length, apiKeys.length);
  return Array.from({ length: count }, (_, index) => ({
    baseUrl: baseUrls[index] ?? '',
    apiKey: apiKeys[index] ?? ''
  }));
}

function createPreviewItem(
  index: number,
  baseUrl: string,
  apiKey: string,
  customName?: unknown
): ParsedSub2ApiImportPreviewItem {
  const normalizedName = cleanToken(customName) || baseUrl;
  const item: ParsedSub2ApiImportPreviewItem = {
    index,
    name: normalizedName,
    baseUrl,
    apiKey,
    maskedApiKey: maskImportApiKey(apiKey),
    status: 'valid',
    message: '可导入'
  };

  if (!baseUrl && !apiKey) {
    item.status = 'invalid';
    item.message = '未解析到 Base URL 和 API Key';
    return item;
  }

  if (!baseUrl) {
    item.status = 'invalid';
    item.message = '未解析到 Base URL';
    return item;
  }

  if (!apiKey) {
    item.status = 'invalid';
    item.message = '未解析到 API Key';
    return item;
  }

  if (!isValidImportBaseUrl(baseUrl)) {
    item.status = 'invalid';
    item.message = 'Base URL 格式不合法';
    return item;
  }

  return item;
}

function markDuplicatePreviewItems(items: ParsedSub2ApiImportPreviewItem[]): ParsedSub2ApiImportPreviewItem[] {
  const seen = new Map<string, number>();

  return items.map((item, index) => {
    const nextItem: ParsedSub2ApiImportPreviewItem = {
      ...item,
      index: index + 1
    };

    if (nextItem.status !== 'valid') {
      return nextItem;
    }

    const key = `${nextItem.baseUrl}\n${nextItem.apiKey}`;
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      nextItem.status = 'invalid';
      nextItem.message = `与第 ${firstIndex + 1} 条重复`;
      return nextItem;
    }

    seen.set(key, index);
    return nextItem;
  });
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function looksLikeApiKey(value: string): boolean {
  if (!value || value.length < 8 || /\s/.test(value)) {
    return false;
  }

  if (/^https?:\/\//i.test(value)) {
    return false;
  }

  if (/^(?:sk|rk|sess|key)-/i.test(value)) {
    return true;
  }

  if (/^[a-z0-9][a-z0-9._-]{15,}$/i.test(value) && /[a-z]/i.test(value) && /\d/.test(value)) {
    return true;
  }

  return /^[A-Za-z0-9_\-.=]{24,}$/.test(value);
}

function cleanToken(value: unknown): string {
  let text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  while (text.length > 1 && WRAPPER_CHARS.includes(text[0] ?? '')) {
    text = text.slice(1).trimStart();
  }

  while (text.length > 1 && WRAPPER_CHARS.includes(text[text.length - 1] ?? '')) {
    text = text.slice(0, -1).trimEnd();
  }

  return text;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
