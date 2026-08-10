// POST handlers for browser form submissions. The UI progressively enhances
// each form (`<form method=post action="/ui/...">`), so the server side has to
// support native HTML form posts as well.

import { Hono } from "hono";
import type { Context } from "hono";
import { browserAuthMiddleware } from "./browser-auth";
import { esc } from "./render";
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
  if (!origin) return null; // non-browser (curl) — allow
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

/** Minimal same-origin page that surfaces a secret exactly once (M2/M3):
 *  client secrets and feed tokens are hashed at rest, so the only chance to
 *  show the plaintext is immediately after creation/rotation. */
function secretPage(title: string, intro: string, rows: [string, string][], back: string): string {
  const rowHtml = rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong><br><code>${esc(v)}</code></p>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5"><h1>${esc(title)}</h1><p>${esc(intro)}</p>${rowHtml}<p><a href="${esc(back)}">Back</a></p></body></html>`;
}

/**
 * Returns the /ui/* sub-app. Pipeline: cookie session → Origin check (CSRF
 * defense on top of SameSite=Strict) → form parse → mutate via @openbag/core
 * (ADR-0011: /api/* stays JSON-only) → 303 back to the page.
 */
export function uiActionRoutes() {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", browserAuthMiddleware({ required: true }));

  app.post("/settings", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{
      theme?: string;
      items_per_page?: string;
      reading_speed?: string;
      language?: string;
      action_mark_as_read?: string; // HTML checkboxes submit "on"
      list_mode?: string;
      display_thumbnails?: string;
    }>(c);
    await updateConfig(c.env, user.id, {
      theme: body.theme,
      items_per_page: body.items_per_page ? parseInt(body.items_per_page, 10) : undefined,
      reading_speed: body.reading_speed ? parseInt(body.reading_speed, 10) : undefined,
      language: body.language,
      action_mark_as_read: body.action_mark_as_read === "on" ? 1 : 0,
      list_mode: body.list_mode === "on" ? 1 : 0,
      display_thumbnails: body.display_thumbnails === "on" ? 1 : 0,
    });
    return c.redirect("/settings?success=1", 303);
  });

  app.post("/feed/token/rotate", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const token = await rotateFeedToken(c.env, user.id); // raw once — hashed at rest (M3)
    const base = new URL(c.req.url).origin;
    const u = encodeURIComponent(user.username);
    return c.html(secretPage(
      "Feed token rotated",
      "Copy this now — the token is shown only once.",
      [
        ["token", token],
        ["Atom", `${base}/api/feeds/${u}.atom?token=${token}`],
        ["RSS", `${base}/api/feeds/${u}.xml?token=${token}`],
      ],
      "/settings",
    ));
  });

  app.post("/feed/token/revoke", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    await revokeFeedToken(c.env, user.id);
    return c.redirect("/settings", 303);
  });

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
      // `createEntry` re-parses asynchronously — don't trigger it again here.
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

  app.post("/oauth/clients", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as { id: number; username: string };
    const body = await parseForm<{ name?: string }>(c);
    const name = (body.name || "").trim();
    if (!name) return c.redirect("/developer", 303);
    // Mirrors the API's defaults. Secret is shown once below (hashed at rest, M2).
    const created = await createClient(c.env, user.id, name, [], ["password", "refresh_token"]);
    return c.html(secretPage(
      `Client created: ${name}`,
      "Copy these now — the secret is shown only once.",
      [
        ["Client ID", `${created.id}_${created.random_id}`],
        ["Secret", created.secret],
      ],
      "/developer",
    ));
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
