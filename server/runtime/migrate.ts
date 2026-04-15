import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { SQLiteD1Database } from './sqlite-d1.js';

const MIGRATION_TABLE = '_schema_migrations';

const BENIGN_ERROR_PATTERNS = [/duplicate column name/i, /already exists/i];

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isBenignMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return BENIGN_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export async function runMigrations(db: SQLiteD1Database, migrationsDir: string): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const { results } = await db
    .prepare(`SELECT name FROM ${MIGRATION_TABLE} ORDER BY name`)
    .all<{ name: string }>();
  const appliedMigrations = new Set(results.map((item) => item.name));
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const executed: string[] = [];
  for (const fileName of migrationFiles) {
    if (appliedMigrations.has(fileName)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, fileName), 'utf8');
    const statements = splitSqlStatements(sql);

    db.raw.exec('BEGIN');
    try {
      for (const statement of statements) {
        try {
          db.raw.exec(statement);
        } catch (error) {
          if (!isBenignMigrationError(error)) {
            throw error;
          }
        }
      }

      db.raw
        .prepare(`INSERT INTO ${MIGRATION_TABLE} (name) VALUES (?)`)
        .run(fileName);
      db.raw.exec('COMMIT');
      executed.push(fileName);
    } catch (error) {
      db.raw.exec('ROLLBACK');
      throw new Error(`执行迁移 ${fileName} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return executed;
}
