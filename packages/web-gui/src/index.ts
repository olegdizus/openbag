// @openbag/web-gui Worker entrypoint. Owns HTML routes (/ /entries /entry
// /settings /tags /import /developer), the /ui/* form-POST mutations
// (ADR-0014), and the static-asset ASSETS binding. Shares the same D1
// `database_id` as packages/api but lives in a separate Cloudflare Worker
// with a separate deploy revision.

import { uiApp } from "./app";

// Re-exported for direct drive in tests.
export { uiApp };

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return uiApp.fetch(request, env, ctx);
  },
};

