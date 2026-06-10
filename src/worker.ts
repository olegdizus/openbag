import { Hono } from "hono";
import { app as apiApp } from "@wallabag/api";
import { webRoutes } from "@wallabag/web";
import { createDispatcher } from "../packages/core/src/queue/consumers";
import { handleEntryRefetch } from "../packages/core/src/queue/entry-refetch";

const root = new Hono();

root.route("/", apiApp);
root.route("/", webRoutes());

// Queue handler — dispatches by message body.type
const dispatcher = createDispatcher({
  ENTRY_REFETCH: handleEntryRefetch,
});

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
  queue: dispatcher,
};
