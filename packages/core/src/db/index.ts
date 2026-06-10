// D1 client wrapper, query helpers, schema types, pagination

export * from "./types";
export * from "./pagination";

export interface D1Result<T> {
  results: T[];
  success: boolean;
}

export interface D1SingleResult<T> {
  results: T[];
  success: boolean;
  meta: { duration: number; changes: number; last_row_id: number };
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): D1ExecResult;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T>(col?: string): Promise<T | null>;
  all<T>(col?: string): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}

export interface D1ExecResult {
  count: { rows: number };
  duration: number;
}

export class D1Client {
  constructor(private db: D1Database) {}

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    const { results } = await this.db.prepare(sql).bind(...params).all<T>();
    return results as T[];
  }

  async one<T>(sql: string, params: any[] = []): Promise<T | null> {
    const result = await this.db.prepare(sql).bind(...params).first<T>();
    return result ?? null;
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
    const result = await this.db.prepare(sql).bind(...params).run();
    return { changes: result.meta.changes };
  }

  async batch(statements: { sql: string; params?: any[] }[]): Promise<any[]> {
    const prepared = statements.map((s) =>
      this.db.prepare(s.sql).bind(...(s.params ?? []))
    );
    return await this.db.batch(prepared);
  }
}
