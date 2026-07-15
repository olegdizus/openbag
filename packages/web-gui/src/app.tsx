// web-gui/src/app.tsx — the web-gui Worker Hono app.
//
// Server-rendered pages mounted at the root. Per ADR-0018 the web-gui Worker
// shares D1 with the API Worker and reads data via `@openbag/core` directly
// (no HTTP-mediated SSR → /api seam). Auth model: UI pages run under
// `browserAuthMiddleware` (cookie session → 302 redirect to /login).

import { Hono } from "hono";
import { browserAuthMiddleware } from "./browser-auth";
import { LoginPage } from "./pages/login";
import { EntriesPage } from "./pages/entries";
import { EntryPage } from "./pages/entry";
import { TagsPage } from "./pages/tags";
import { SettingsPage } from "./pages/settings";
import { DeveloperPage } from "./pages/developer";
import { ImportPage } from "./pages/import";
import { homeRoute } from "./pages/home";
import { uiActionRoutes } from "./actions";

// Hono app with ambient Variables for `user` (set by browserAuthMiddleware).
// `c.env` is the web-gui Worker bindings (DB + ASSETS + ALLOWED_REGISTRATION).
interface AuthVars {
  user: { id: number; username: string };
}
export const uiApp = new Hono<{ Variables: AuthVars }>();

// ---- Public routes (no auth) ----------------------------------------------

uiApp.get("/", homeRoute);

const originOf = (c: any): string => {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
};

uiApp.get("/login", (c) =>
  c.html(
    <LoginPage
      env={c.env}
      next={c.req.query("next") || "/entries"}
      error={c.req.query("error") || undefined}
    />,
  ),
);

uiApp.get("/signup", (c) =>
  c.html(
    <LoginPage
      env={c.env}
      next={c.req.query("next") || "/entries"}
      error={c.req.query("error") || undefined}
    />,
  ),
);

// ---- Authed routes --------------------------------------------------------

uiApp.get("/entries", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  const url = new URL(c.req.url);
  return c.html(<EntriesPage user={user} env={c.env} query={url.search.replace(/^\?/, "")} />);
});

uiApp.get("/entry", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  const id = parseInt(c.req.query("id") || "", 10);
  return c.html(<EntryPage user={user} env={c.env} id={id} />);
});

uiApp.get("/tags", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  return c.html(<TagsPage user={user} env={c.env} />);
});

uiApp.get("/settings", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  const success = c.req.query("success") === "1";
  return c.html(
    <SettingsPage user={user} env={c.env} baseUrl={originOf(c)} success={success} />,
  );
});

uiApp.get("/developer", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  return c.html(<DeveloperPage user={user} env={c.env} />);
});

uiApp.get("/import", browserAuthMiddleware({ required: true }), async (c) => {
  const user = c.get("user") as { id: number; username: string };
  const importedParam = c.req.query("imported");
  const imported = importedParam != null && importedParam !== "" ? parseInt(importedParam, 10) : undefined;
  return c.html(
    <ImportPage user={user} imported={imported} error={c.req.query("error") || undefined} />,
  );
});

// ---- Form-POST mutation routes (PRG pattern, 303 → SSR page) --------------

uiApp.route("/ui", uiActionRoutes());
