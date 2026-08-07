export * from "./types";

/**
 * Thin wrapper over a D1 `prepare(...).bind(...).{all|first|run}()` chain.
 * Canonical D1 access seam — every query helper in `@openbag/core` accepts a
 * `D1Client` and uses these three methods. The constructor takes a `D1Database`
 * binding (ambient via `@cloudflare/workers-types`, no import needed).
 */
export class D1Client {
  constructor(private db: D1Database) { }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return results as T[];
  }

  async one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.db.prepare(sql).bind(...params).first<T>();
    return r ?? null;
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastRowId: number }> {
    const r = await this.db.prepare(sql).bind(...params).run();
    return { changes: r.meta.changes, lastRowId: r.meta.last_row_id };
  }
}
