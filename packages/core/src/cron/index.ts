// Cron (scheduled) job dispatcher and implementations.
// See SPEC §5.11 — three schedules (Cloudflare cron: day-of-week must be
// named SUN-SAT or 1-7; "0" for Sunday is rejected):
//   hourly:           token cleanup + orphan tag removal
//   daily 03:00 UTC:  refetch failed entries (is_not_parsed = 1)
//   weekly Sun 00:00: cleanup orphaned images, re-apply tagging rules

import { D1Client } from "../db";
import { enqueueEntryRefetch } from "../queue/producers";

const db = (env: any) => new D1Client(env.DB);

/** Delete expired OAuth tokens (access, refresh, auth codes). */
export async function cleanupExpiredTokens(env: any): Promise<void> {
  const access = await db(env).run(
    "DELETE FROM oauth_access_tokens WHERE expires_at <= datetime('now')"
  );
  const refresh = await db(env).run(
    "DELETE FROM oauth_refresh_tokens WHERE expires_at <= datetime('now')"
  );
  const codes = await db(env).run(
    "DELETE FROM oauth_auth_codes WHERE expires_at <= datetime('now')"
  );
  console.log(
    `[cron] cleaned expired tokens: access=${access.changes} refresh=${refresh.changes} codes=${codes.changes}`
  );
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

/** Re-apply tagging rules — placeholder: full rule engine lives in tagging-rules feature. */
export async function reapplyTaggingRules(env: any): Promise<void> {
  const rules = await db(env).one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM tagging_rules"
  );
  console.log(`[cron] reapply tagging rules: ${rules?.n ?? 0} rules present (no-op)`);
}

/**
 * Dispatch a scheduled event by its cron schedule string.
 * Keeps the worker's `scheduled` handler trivial and testable.
 */
export async function runScheduledJob(env: any, cron: string): Promise<void> {
  switch (cron) {
    case "0 * * * *": // hourly
      await cleanupExpiredTokens(env);
      await removeOrphanTags(env);
      break;
    case "0 3 * * *": // daily 03:00 UTC
      await refetchFailedEntries(env);
      break;
    case "0 0 * * SUN": // weekly Sunday 00:00 UTC
      await reapplyTaggingRules(env);
      break;
    default:
      console.warn(`[cron] unknown schedule: ${cron}`);
  }
}
