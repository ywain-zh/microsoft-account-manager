import { resolveRuntimeConfig } from '../runtime/env.js';
import { runMigrations } from '../runtime/migrate.js';
import { SQLiteD1Database } from '../runtime/sqlite-d1.js';

const config = resolveRuntimeConfig();
const db = new SQLiteD1Database(config.dbPath);

try {
  const executed = await runMigrations(db, config.migrationsDir);
  console.log(
    executed.length > 0 ? `已执行迁移: ${executed.join(', ')}` : '没有新的迁移需要执行'
  );
} finally {
  db.close();
}
