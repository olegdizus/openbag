// OAuth client CRUD for the developer UI. Intentionally separate from
// `auth/routes.ts` (`/oauth/v2/token` etc.) — those are the OAuth2 protocol
// routes used by Wallabag clients.

import { Hono } from "hono";
import {
  createClient,
  deleteClient,
  listClients,
  D1Client,
} from "@openbag/core";

export function apiOauthRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.get("/clients", async (c) => {
    const user = c.get("user") as { id: number };
    const list = await listClients(c.env, user.id);
    return c.json({ items: list });
  });

  // Body: { name, redirect_uris?, allowed_grant_types? }. Returns the created client
  // including its plaintext secret — only visible this once.
  app.post("/clients", async (c) => {
    const user = c.get("user") as { id: number };
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "Missing 'name'" }, 400);
    const redirectUris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : [])
      .filter((u: unknown) => typeof u === "string" && (u as string).length <= 512)
      .slice(0, 16);
    // Validate grant types against the allowlist (L3) — stored values are
    // otherwise unused (auth-code flow is a stub) but unchecked input is a smell.
    const GRANTS = new Set(["password", "refresh_token", "authorization_code"]);
    const allowed = (Array.isArray(body.allowed_grant_types) ? body.allowed_grant_types : ["password", "refresh_token"])
      .filter((g: unknown) => typeof g === "string" && GRANTS.has(g as string));
    const created = await createClient(c.env, user.id, name, redirectUris, allowed);
    return c.json(created, 201);
  });

  app.delete("/clients/:id", async (c) => {
    const user = c.get("user") as { id: number };
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "Invalid client id" }, 400);
    }
    // Guard against cross-user deletes (deleteClient filters by user_id, but
    // we also 404 instead of silently succeeding for cleaner UX).
    const db = new D1Client(c.env.DB);
    const owned = await db.one("SELECT id FROM oauth_clients WHERE id = ? AND user_id = ?", [
      id,
      user.id,
    ]);
    if (!owned) return c.json({ error: "Not found" }, 404);
    await deleteClient(c.env, user.id, id);
    return c.json({ success: true });
  });

  return app;
}
