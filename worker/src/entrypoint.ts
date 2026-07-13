import { Hono } from "hono";
import { app as apiApp } from "./api";
import { runScheduledJob, handleEntryRefetch } from "./index";

const root = new Hono();

root.route("/", apiApp);

export default {
  fetch: async (request: Request, env: any, ctx: any) => {
    const url = new URL(request.url);
    // Strip .json suffix before routing — Wallabag uses Symfony's .{_format} pattern
    if (url.pathname.endsWith(".json")) {
      url.pathname = url.pathname.replace(/\.json$/, "");
      request = new Request(url.toString(), request);
    }
    return root.fetch(request, env, ctx);
  },
  queue: async (batch: { body: { type: string } }[], env: any) => {
    for (const msg of batch) {
      if (msg.body.type === "ENTRY_REFETCH") {
        await handleEntryRefetch([msg as any], env);
      } else {
        console.log(`No handler for queue message type: ${msg.body.type}`);
      }
    }
  },
  scheduled: async (event: ScheduledEvent, env: any, _ctx: ExecutionContext) => {
    try {
      await runScheduledJob(env, event.cron);
    } catch (err) {
      console.error(`[scheduled] cron "${event.cron}" failed: ${(err as Error).message}`);
      throw err;
    }
  },
};
