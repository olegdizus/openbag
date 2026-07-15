// Cron (scheduled) job dispatcher and implementations.
//   hourly:          token cleanup + orphan tag removal
//   daily 03:00 UTC: refetch failed entries (is_not_parsed = 1)

import { D1Client } from "@openbag/core";
import { enqueueEntryRefetch } from "../queue/producers";

const db = (env: any) => new D1Client(env.DB);

/** Delete expired OAuth tokens (access, refresh, auth codes). */
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

/** Delete expired sessions (browser cookie auth — sessions table). */
export async function cleanupExpiredSessions(env: any): Promise<void> {
  const r = await db(env).run(
    `DELETE FROM sessions WHERE expires_at <= datetime('now')`
  );
  console.log(`[cron] cleaned expired sessions: ${r.changes} rows`);
}

/** Remove tags that no longer have any entries linked. */
export async function removeOrphanTags(env: any): Promise<void> {
  const res = await db(env).run(
    `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM entry_tags)`
  );
  console.log(`[cron] removed orphan tags: ${res.changes}`);
}

/** Enqueue refetch jobs for entries that failed to parse. */
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
 * Keeps the worker's `scheduled` handler trivial and testable.
 */
export async function runScheduledJob(env: any, cron: string): Promise<void> {
  switch (cron) {
    case "0 * * * *": // hourly
      await cleanupExpiredTokens(env);
      await cleanupExpiredSessions(env);
      await removeOrphanTags(env);
      break;
    case "0 3 * * *": // daily 03:00 UTC
      await refetchFailedEntries(env);
      break;
    default:
      console.warn(`[cron] unknown schedule: ${cron}`);
  }
}
