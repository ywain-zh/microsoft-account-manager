import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

type StatementResult = {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
};

type BetterSqliteDatabase = InstanceType<typeof Database>;
type SQLInputValue = string | number | bigint | Uint8Array | Buffer | null;

function normalizeInteger(value: number | bigint | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'bigint' ? Number(value) : value;
}

function toSqlInputValues(values: unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (value === undefined) {
      return null;
    }
    return value as SQLInputValue;
  });
}

class SQLiteD1PreparedStatement implements D1PreparedStatement {
  private readonly values: unknown[];

  constructor(
    private readonly database: BetterSqliteDatabase,
    private readonly query: string,
    values: unknown[] = []
  ) {
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SQLiteD1PreparedStatement(this.database, this.query, values);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const statement = this.database.prepare(this.query);
    const row = statement.get(...toSqlInputValues(this.values)) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    if (column) {
      return (row[column] as T | undefined) ?? null;
    }

    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: boolean;
    meta: D1Result['meta'];
  }> {
    const startedAt = Date.now();
    const statement = this.database.prepare(this.query);
    const rows = statement.all(...toSqlInputValues(this.values)) as T[];

    return {
      results: rows,
      success: true,
      meta: {
        duration: Date.now() - startedAt,
        rows_read: rows.length
      }
    };
  }

  async run(): Promise<D1Result> {
    const startedAt = Date.now();
    const statement = this.database.prepare(this.query);
    const result = statement.run(...toSqlInputValues(this.values)) as StatementResult;
    const changes = normalizeInteger(result.changes);

    return {
      success: true,
      meta: {
        duration: Date.now() - startedAt,
        changes,
        rows_written: changes,
        last_row_id: normalizeInteger(result.lastInsertRowid)
      }
    };
  }
}

export class SQLiteD1Database implements D1Database {
  readonly raw: BetterSqliteDatabase;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.raw = new Database(databasePath);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
  }

  prepare(query: string): D1PreparedStatement {
    return new SQLiteD1PreparedStatement(this.raw, query);
  }

  async exec(query: string): Promise<D1Result> {
    const startedAt = Date.now();
    this.raw.exec(query);
    return {
      success: true,
      meta: {
        duration: Date.now() - startedAt
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}
