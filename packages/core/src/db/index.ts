export * from "./types";
export * from "./pagination";

export class D1Client {
  constructor(private db: any) {}
  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return results as T[];
  }
  async one<T>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.db.prepare(sql).bind(...params).first<T>();
    return r ?? null;
  }
  async run(sql: string, params: any[] = []): Promise<{ changes: number; lastRowId: number }> {
    const r = await this.db.prepare(sql).bind(...params).run();
    return { changes: r.meta.changes, lastRowId: r.meta.last_row_id };
  }
}
