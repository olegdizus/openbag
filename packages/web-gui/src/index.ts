// @openbag/web-gui Worker. Sibling to packages/api (separate deploy, same D1).
// ADR-0014 holds the /ui/* mutation contract.

import { uiApp } from "./app";

export { uiApp };

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return uiApp.fetch(request, env, ctx);
  },
};
