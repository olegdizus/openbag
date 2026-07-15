// web-gui/src/actions.ts — POST handlers for browser form submissions.
//
// The UI progressively enhances each form (`<form method=post action="/ui/...">`),
// so the server side has to support native HTML form posts as well. Each
// handler:
//   1. Verifies a session cookie (via `browserAuthMiddleware` at mount).
//   2. Validates `Origin` (CSRF defense — `SameSite=Strict` already protects
//      most cases; this guards against cross-origin navigational POSTs).
//   3. Parses `application/x-www-form-urlencoded` / `multipart/form-data`.
//   4. Mutates via `@openbag/core` (single source of truth).
//   5. Issues a 303 (See Other) redirect back to the originating page so the
//      browser does an immediate GET (PRG pattern).
//
// `/api/*` stays JSON-only (ADR-0011). Every mutation here funnels through
// the same `@openbag/core` query helpers the `/api/*` Worker uses — same SQL,
// same enrichment; no HTTP round-trip, no second-tier contract.

import { Hono } from "hono";
import type { Context } from "hono";
import { browserAuthMiddleware } from "./browser-auth";
import {
  updateConfig,
  rotateFeedToken,
  revokeFeedToken,
  createEntry,
  createEntriesBulk,
  deleteTagsByLabels,
  createClient,
  deleteClient,
} from "@openbag/core";

/** The `c.get("user")` shape provided by `browserAuthMiddleware`. */
interface AuthVars {
  user: { id: number; username: string };
}

/**
 * Reject cross-origin POST (CSRF). Mirrors `requireSameOrigin` in
 * `packages/api/src/routes/auth.ts` — `SameSite=Strict` already makes
 * the cookie conditional on same-site but this is defense-in-depth.
 *
 * Returns `null` to allow; a Response to forbid. We construct the Response
 * directly (rather than `c.body()`) so the helper doesn't need Hono's typed
 * context for the cross-origin text response.
 */
function requireSameOrigin(c: Context): Response | null {
  const origin = c.req.header("origin");
  if (!origin) return null; // No Origin → curl/non-browser → allow.
  try {
    const originUrl = new URL(origin);
    const reqUrl = new URL(c.req.url);
    return originUrl.host === reqUrl.host
      ? null
      : new Response("Cross-origin denied", { status: 403 });
  } catch {
    return new Response("Invalid Origin", { status: 403 });
  }
}

/** Parse a form (urlencoded OR multipart). Returns {} on JSON/missing body. */
async function parseForm<T = Record<string, any>>(c: Context): Promise<T> {
  const ct = (c.req.header("content-type") || "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    return (await c.req.parseBody()) as T;
  }
  return {} as T;
}

export function uiActionRoutes() {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", browserAuthMiddleware({ required: true }));

  // ---- Settings -----------------------------------------------------------

  app.post("/settings", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{
      theme?: string;
      items_per_page?: string;
      reading_speed?: string;
      language?: string;
      action_mark_as_read?: string; // checkbox-on
      list_mode?: string;
      display_thumbnails?: string;
    }>(c);
    await updateConfig(c.env, user.id, {
      theme: body.theme,
      items_per_page: body.items_per_page ? parseInt(body.items_per_page, 10) : undefined,
      reading_speed: body.reading_speed ? parseInt(body.reading_speed, 10) : undefined,
      language: body.language,
      // Checkboxes submit their value only when checked; missing = off.
      action_mark_as_read: body.action_mark_as_read === "on" ? 1 : 0,
      list_mode: body.list_mode === "on" ? 1 : 0,
      display_thumbnails: body.display_thumbnails === "on" ? 1 : 0,
    });
    return c.redirect("/settings?success=1", 303);
  });

  // ---- Feed token ---------------------------------------------------------

  app.post("/feed/token/rotate", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    await rotateFeedToken(c.env, user.id);
    return c.redirect("/settings", 303);
  });

  app.post("/feed/token/revoke", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    await revokeFeedToken(c.env, user.id);
    return c.redirect("/settings", 303);
  });

  // ---- Import -------------------------------------------------------------

  app.post("/import/single", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{ url?: string; title?: string }>(c);
    const url = (body.url || "").trim();
    if (!url) return c.redirect("/import?error=" + encodeURIComponent("Missing URL"), 303);
    try {
      new URL(url);
    } catch {
      return c.redirect("/import?error=" + encodeURIComponent("Invalid URL"), 303);
    }
    try {
      const entry = await createEntry(c.env, user.id, {
        url,
        title: body.title && body.title.trim() ? body.title.trim() : undefined,
      });
      // Background fetch of article content is handled by `createEntry`'s
      // `waitUntil`-deferred re-parse; no additional action needed here.
      return c.redirect(`/entry?id=${entry.id}`, 303);
    } catch {
      return c.redirect("/import?error=" + encodeURIComponent("Could not create entry"), 303);
    }
  });

  app.post("/import/bulk", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{ urls?: string }>(c);
    const urls = (body.urls || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length) return c.redirect("/import?error=" + encodeURIComponent("Paste at least one URL."), 303);
    const results = await createEntriesBulk(c.env, user.id, urls);
    return c.redirect(`/import?imported=${results.length}`, 303);
  });

  // ---- Tags ---------------------------------------------------------------

  app.post("/tags/delete", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{ label?: string }>(c);
    const label = (body.label || "").trim();
    if (label) {
      await deleteTagsByLabels(c.env, user.id, [label]);
    }
    return c.redirect("/tags", 303);
  });

  // ---- OAuth clients ------------------------------------------------------

  app.post("/oauth/clients", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{ name?: string }>(c);
    const name = (body.name || "").trim();
    if (!name) return c.redirect("/developer", 303);
    // Browser-created clients get the same defaults the API used: no redirect
    // URIs, password + refresh_token grants.
    await createClient(c.env, user.id, name, [], ["password", "refresh_token"]);
    return c.redirect("/developer", 303);
  });

  app.post("/oauth/clients/:id/delete", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isInteger(id) && id > 0) {
      await deleteClient(c.env, user.id, id);
    }
    return c.redirect("/developer", 303);
  });

  return app;
}
