import { D1Client } from "@openbag/core";
import { enqueueEntryRefetch } from "../queue/producers";

const db = (env: any) => new D1Client(env.DB);

/** Clears expired rows from all three OAuth token tables (access, refresh, auth codes). */
export async function cleanupExpiredTokens(env: any): Promise<void> {
  let total = 0;
  for (const table of ["oauth_access_tokens", "oauth_refresh_tokens", "oauth_auth_codes"]) {
    const r = await db(env).run(
      `DELETE FROM ${table} WHERE expires_at <= datetime('now')`
    );
    total += r.changes;
  }
  console.log(`[cron] cleaned expired tokens: ${total} rows`);
}

/** Clears the browser-session `sessions` table of expired rows. */
export async function cleanupExpiredSessions(env: any): Promise<void> {
  const r = await db(env).run(
    `DELETE FROM sessions WHERE expires_at <= datetime('now')`
  );
  console.log(`[cron] cleaned expired sessions: ${r.changes} rows`);
}

/** L1: evict aged brute-force rows so login_attempts can't grow unbounded
 *  (each failure writes 2 rows). Keeps the throttling COUNT(*) fast. */
export async function cleanupOldLoginAttempts(env: any): Promise<void> {
  const r = await db(env).run(
    `DELETE FROM login_attempts WHERE attempted_at <= datetime('now', '-1 day')`
  );
  console.log(`[cron] purged login_attempts older than 1 day: ${r.changes} rows`);
}

/** Drops tags with zero entry_tags links left over after entry/tag deletion. */
export async function removeOrphanTags(env: any): Promise<void> {
  const res = await db(env).run(
    `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM entry_tags)`
  );
  console.log(`[cron] removed orphan tags: ${res.changes}`);
}

/** Fan-out: enqueue one refetch job per entry still flagged `is_not_parsed = 1`. */
export async function refetchFailedEntries(env: any): Promise<void> {
  const queue = env.ENTRY_REFETCH;
  if (!queue) {
    console.error("[cron] ENTRY_REFETCH queue binding missing — cannot refetch failed entries");
    return;
  }
  const failed = await db(env).all<{ id: number; user_id: number; url: string }>(
    "SELECT id, user_id, url FROM entries WHERE is_not_parsed = 1"
  );
  for (const entry of failed) {
    await enqueueEntryRefetch(queue, entry.id, entry.user_id);
  }
  console.log(`[cron] enqueued refetch for ${failed.length} failed entries`);
}

/**
 * Dispatch a scheduled event by its cron schedule string.
 *   hourly (`0 * * * *`):          token cleanup + orphan tag removal
 *   daily 03:00 UTC (`0 3 * * *`): refetch failed entries (is_not_parsed = 1)
 * Keeps the worker's `scheduled` handler trivial and testable.
 */
export async function runScheduledJob(env: any, cron: string): Promise<void> {
  switch (cron) {
    case "0 * * * *": // hourly
      await cleanupExpiredTokens(env);
      await cleanupExpiredSessions(env);
      await cleanupOldLoginAttempts(env);
      await removeOrphanTags(env);
      break;
    case "0 3 * * *": // daily 03:00 UTC
      await refetchFailedEntries(env);
      break;
    default:
      console.warn(`[cron] unknown schedule: ${cron}`);
  }
}
