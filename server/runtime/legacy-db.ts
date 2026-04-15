import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

export interface LegacyImportResult {
  imported: boolean;
  sourcePath: string | null;
  destinationPath: string;
}

function validateDatabaseShape(databasePath: string): void {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((item) => item.name));

    if (!tableNames.has('accounts') || !tableNames.has('app_settings')) {
      throw new Error('数据库缺少必要表 accounts 或 app_settings');
    }
  } finally {
    database.close();
  }
}

export function findLegacyDatabase(legacyDirectory: string): string | null {
  if (!existsSync(legacyDirectory)) {
    return null;
  }

  const sqliteFiles = readdirSync(legacyDirectory)
    .filter((entry) => entry.endsWith('.sqlite'))
    .map((entry) => resolve(join(legacyDirectory, entry)));

  if (sqliteFiles.length === 0) {
    return null;
  }

  sqliteFiles.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return sqliteFiles[0] ?? null;
}

export function importLegacyDatabase(options: {
  databasePath: string;
  legacyDirectory: string;
  overwrite?: boolean;
}): LegacyImportResult {
  const databasePath = resolve(options.databasePath);
  const sourcePath = findLegacyDatabase(resolve(options.legacyDirectory));
  if (!sourcePath) {
    return {
      imported: false,
      sourcePath: null,
      destinationPath: databasePath
    };
  }

  if (existsSync(databasePath) && !options.overwrite) {
    return {
      imported: false,
      sourcePath,
      destinationPath: databasePath
    };
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  copyFileSync(sourcePath, databasePath);
  validateDatabaseShape(databasePath);

  return {
    imported: true,
    sourcePath,
    destinationPath: databasePath
  };
}
