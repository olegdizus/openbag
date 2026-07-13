// OAuth client CRUD for the developer UI (browser side).
//
// Mirrors `worker/src/auth/features/clients/index.ts` (the data helpers), but
// exposes them as REST endpoints protected by authMiddleware — so the
// developer page can list/create/delete its own OAuth clients via cookie auth.
//
// This is intentionally separate from `auth/routes.ts` (`/oauth/v2/token` etc.)
// which is the OAuth2 protocol flow Wallabag clients use.

import { Hono } from "hono";
import {
  createClient,
  deleteClient,
  listClients,
  D1Client,
} from "../../../index";

/**
 * OAuth client management — mounted under `/api/oauth` in `api/index.ts`.
 * All routes require an authenticated user (Bearer or cookie).
 */
export function apiOauthRoutes() {
  const app = new Hono();

  // GET /api/oauth/clients — list the current user's OAuth clients
  app.get("/clients", async (c) => {
    const user = c.get("user") as { id: number };
    const list = await listClients(c.env, user.id);
    return c.json({ items: list });
  });

  // POST /api/oauth/clients — create a new client
  // Body: { name: string, redirect_uris?: string[], allowed_grant_types?: string[] }
  // Returns the created client (including the plaintext secret — only visible this once).
  app.post("/clients", async (c) => {
    const user = c.get("user") as { id: number };
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "Missing 'name'" }, 400);
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const allowed = Array.isArray(body.allowed_grant_types)
      ? body.allowed_grant_types
      : ["password", "refresh_token"];
    const created = await createClient(c.env, user.id, name, redirectUris, allowed);
    return c.json(created, 201);
  });

  // DELETE /api/oauth/clients/:id — delete one of the user's clients
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
