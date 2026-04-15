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

export function resolveRuntimeConfig(): RuntimeConfig {
  const rootDir = process.cwd();
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
    mailApiToken: process.env.MAIL_API_TOKEN?.trim() || ''
  };
}
