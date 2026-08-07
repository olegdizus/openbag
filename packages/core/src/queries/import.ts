// Shared helpers for entry creation (ADR-0014). Thin wrapper around
// `createEntry` from the entries queries module — "import" is conceptually
// just bulk create. The legacy file-upload path isn't needed by the UI, so
// this module exposes just URL-based single+bulk creates plus a hash lookup.

import { D1Client } from "../db";
import { createEntry, hashUrl, type Entry } from "./entries";

export { createEntry, hashUrl };
export type { Entry };

export interface BulkResult {
  id: number;
  url: string;
  /** Created new (true) or already existed (false). */
  created: boolean;
}

/**
 * Create entries for each URL in `urls` (skipping existing ones). Does NOT
 * trigger background content fetch — that's the caller's responsibility
 * (passed a `waitUntil` callback when used from a Worker context).
 *
 * Returns one entry-shaped result per URL, in input order.
 */
export async function createEntriesBulk(env: any, userId: number, urls: string[]): Promise<BulkResult[]> {
  const dbc = new D1Client(env.DB);
  const out: BulkResult[] = [];
  for (const url of urls) {
    const urlHash = hashUrl(url);
    const existing = await dbc.one<{ id: number }>(
      "SELECT id FROM entries WHERE user_id = ? AND url_hash = ?",
      [userId, urlHash],
    ).catch(() => null);
    if (existing) { out.push({ id: existing.id, url, created: false }); continue; }
    let domainName: string | null = null;
    try { domainName = new URL(url).hostname; } catch { /* leave null */ }
    await dbc.run(
      "INSERT INTO entries (user_id, url, url_hash, title, domain_name, mimetype, is_not_parsed) VALUES (?, ?, ?, ?, ?, 'text/html', 1)",
      [userId, url, urlHash, url, domainName],
    );
    const idRow = await dbc.one<{ id: number }>("SELECT last_insert_rowid() as id", []);
    const id = idRow?.id ?? 0;
    out.push({ id, url, created: true });
  }
  return out;
}
