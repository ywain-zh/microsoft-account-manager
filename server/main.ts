import { serve } from '@hono/node-server';

import app, { startMicrosoftTokenRefreshScheduler } from './app.js';
import { resolveRuntimeConfig } from './runtime/env.js';
import { importLegacyDatabase } from './runtime/legacy-db.js';
import { runMigrations } from './runtime/migrate.js';
import { SQLiteD1Database } from './runtime/sqlite-d1.js';
import { createStaticAssetFetcher } from './runtime/static-assets.js';

const config = resolveRuntimeConfig();

if (config.autoImportLegacyDb) {
  const importResult = importLegacyDatabase({
    databasePath: config.dbPath,
    legacyDirectory: config.legacyDbDir
  });

  if (importResult.imported && importResult.sourcePath) {
    console.info(`已自动导入旧 D1 本地数据库: ${importResult.sourcePath}`);
  }
}

const db = new SQLiteD1Database(config.dbPath);

try {
  const executedMigrations = await runMigrations(db, config.migrationsDir);
  if (executedMigrations.length > 0) {
    console.info(`已执行数据库迁移: ${executedMigrations.join(', ')}`);
  }

  const assets = createStaticAssetFetcher(config.publicDir);
  const bindings = {
    DB: db,
    ASSETS: assets,
    ADMIN_USERNAME: config.adminUsername,
    ADMIN_PASSWORD: config.adminPassword,
    SESSION_SECRET: config.sessionSecret,
    INGEST_TOKEN: config.ingestToken,
    MAIL_API_TOKEN: config.mailApiToken,
    MS_CLIENT_ID: config.microsoftClientId,
    MS_CLIENT_SECRET: config.microsoftClientSecret,
    MS_TENANT_ID: config.microsoftTenantId,
    MS_REDIRECT_URI: config.microsoftRedirectUri
  };

  const server = serve({
    fetch: (request) => app.fetch(request, bindings),
    hostname: config.host,
    port: config.port
  });
  const stopTokenRefreshScheduler = startMicrosoftTokenRefreshScheduler(bindings);

  console.info(`account-manager 已启动: http://${config.host}:${config.port}`);

  const shutdown = (signal: string) => {
    console.info(`收到 ${signal}，正在关闭服务`);
    stopTokenRefreshScheduler();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  db.close();
  throw error;
}
