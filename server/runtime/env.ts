import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface RuntimeConfig {
  rootDir: string;
  host: string;
  port: number;
  dbPath: string;
  publicDir: string;
  migrationsDir: string;
  legacyDbDir: string;
  autoImportLegacyDb: boolean;
  adminUsername: string;
  adminPassword: string;
  sessionSecret: string;
  ingestToken: string;
  mailApiToken: string;
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftTenantId: string;
  microsoftRedirectUri: string;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function asPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadDotEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = parseDotEnvValue(rawValue);
  }
}

function parseDotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      : unquoted;
  }

  const hashIndex = trimmed.search(/\s#/);
  return (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).trim();
}

export function resolveRuntimeConfig(): RuntimeConfig {
  const rootDir = process.cwd();
  loadDotEnvFile(resolve(rootDir, '.env'));

  const dbPath = resolve(process.env.DB_PATH ?? resolve(rootDir, 'data/account-manager.db'));
  const legacyDbDir =
    process.env.LEGACY_DB_DIR?.trim() ||
    process.env.LEGACY_D1_DIR?.trim() ||
    resolve(dirname(dbPath), 'wrangler/state/v3/d1/miniflare-D1DatabaseObject');

  return {
    rootDir,
    host: process.env.HOST?.trim() || '0.0.0.0',
    port: asPort(process.env.PORT, 8787),
    dbPath,
    publicDir: resolve(process.env.PUBLIC_DIR ?? resolve(rootDir, 'dist')),
    migrationsDir: resolve(process.env.MIGRATIONS_DIR ?? resolve(rootDir, 'migrations')),
    legacyDbDir: resolve(legacyDbDir),
    autoImportLegacyDb: asBoolean(process.env.AUTO_IMPORT_LEGACY_DB, true),
    adminUsername: process.env.ADMIN_USERNAME?.trim() || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD?.trim() || '',
    sessionSecret: process.env.SESSION_SECRET?.trim() || '',
    ingestToken: process.env.INGEST_TOKEN?.trim() || '',
    mailApiToken: process.env.MAIL_API_TOKEN?.trim() || '',
    microsoftClientId: process.env.MS_CLIENT_ID?.trim() || '',
    microsoftClientSecret: process.env.MS_CLIENT_SECRET?.trim() || '',
    microsoftTenantId: process.env.MS_TENANT_ID?.trim() || '',
    microsoftRedirectUri: process.env.MS_REDIRECT_URI?.trim() || ''
  };
}
