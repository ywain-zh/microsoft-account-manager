export {};

declare global {
  interface D1Result {
    success: boolean;
    results?: unknown[];
    meta: {
      changes?: number;
      last_row_id?: number;
      duration?: number;
      rows_read?: number;
      rows_written?: number;
      size_after?: number;
      served_by?: string;
    };
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: D1Result['meta'] }>;
    run(): Promise<D1Result>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    exec(query: string): Promise<D1Result>;
  }

  interface Fetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }
}
