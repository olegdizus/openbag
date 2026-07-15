// @openbag/api Worker entrypoint. Owns /api/*, /oauth/*, /share/*,
// the entry-refetch queue consumer, and the hourly/daily cron triggers.
// The web-gui Worker (packages/web-gui) is a separate deployable that shares
// the same D1 database and imports @openbag/core directly.

import { app as apiApp } from "./app";
import { handleEntryRefetch } from "./queue/entry-refetch";
import { runScheduledJob } from "./cron";

// Re-exported for direct drive in tests — `app.fetch(...)` lets integration
// tests reach the API router without a fetch loop.
export { apiApp as app };
// Re-export the XML feed builders for unit testing (see tests/unit/feed.test.ts).
export { __testBuildAtom, __testBuildRss } from "./routes/feed";

/**
 * Fetch entry — route the request through the API router.
 *
 * Strip a `.json` suffix before routing (Wallabag uses Symfony's
 * `.{_format}` convention; we honor the suffix but never branch on it).
 */
export async function fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.endsWith(".json")) {
    url.pathname = url.pathname.replace(/\.json$/, "");
    request = new Request(url.toString(), request);
  }
  return apiApp.fetch(request, env, ctx);
}

/** Queue consumer — entry-refetch messages produced by /api/entries POST etc. */
export async function queue(batch: { body: { type: string } }[], env: any): Promise<void> {
  for (const msg of batch) {
    if (msg.body.type === "ENTRY_REFETCH") {
      await handleEntryRefetch([msg as any], env);
    } else {
      console.log(`No handler for queue message type: ${msg.body.type}`);
    }
  }
}

/** Cron trigger — hourly / daily 03:00 UTC, per packages/api/wrangler.jsonc. */
export async function scheduled(event: ScheduledEvent, env: any, _ctx: ExecutionContext): Promise<void> {
  try {
    await runScheduledJob(env, event.cron);
  } catch (err) {
    console.error(`[scheduled] cron "${event.cron}" failed: ${(err as Error).message}`);
    throw err;
  }
}

export default { fetch, queue, scheduled };
