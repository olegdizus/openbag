import { Hono } from "hono";
import { entryRoutes } from "./routes/entries";
import { tagRoutes } from "./routes/tags";
import { annotationRoutes } from "./routes/annotations";
import { searchRoutes } from "./routes/search";
import { configRoutes } from "./routes/config";
import { taggingRuleRoutes } from "./routes/tagging-rules";
import { importRoutes } from "./routes/import";
import { userRoutes } from "./routes/users";
import { shareRoutes } from "./routes/share";
import { feedRoutes, feedPublicRoutes } from "./routes/feed";
import { apiAuthRoutes } from "./routes/auth";
import { apiOauthRoutes } from "./routes/oauth-clients";
import { authRoutes } from "./routes/oauth-protocol";
import { corsMiddleware } from "./middleware/cors";
import { loggingMiddleware } from "./middleware/logging";
import { errorMiddleware } from "./middleware/error-handler";
import { authMiddleware } from "./middleware/auth";
import { isRegistrationEnabled, D1Client } from "@openbag/core";

export const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database; ALLOWED_REGISTRATION?: string } }>();

// Global middleware
app.use("*", corsMiddleware());
app.use("*", loggingMiddleware());
app.use("*", errorMiddleware());

// Public routes (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/version", (c) => c.text("2.5.0"));
app.get("/api/info", (c) => c.json({
  appname: "OpenBag",
  version: "0.1.0",
  allowed_registration: isRegistrationEnabled(c.env),
}));

// Mount OAuth2 protocol routes (Wallabag clients — /oauth/v2/token etc.)
app.route("/", authRoutes());

// Browser auth (login/signup/logout + /me "am I logged in?"). /me is public.
app.route("/api/auth", apiAuthRoutes());

// Protected API routes
const api = new Hono();
api.use("*", authMiddleware());
api.route("/entries", entryRoutes());
api.route("/tags", tagRoutes());
api.route("/annotations", annotationRoutes());
api.route("/search", searchRoutes());
api.route("/config", configRoutes());
api.route("/", taggingRuleRoutes());
api.route("/", importRoutes());
api.route("/", userRoutes());
api.route("/feed", feedRoutes());
api.route("/oauth", apiOauthRoutes());

// DELETE /api/tag/label — singular "tag" path, Wallabag compat
api.delete("/tag/label", async (c: any) => {
  const user = c.get("user");
  const d = new D1Client(c.env.DB);
  let label = c.req.query("tag") || "";
  if (!label) {
    const body = await c.req.json().catch(() => ({}));
    label = body.tag || "";
  }
  if (!label) return c.json({ error: { code: 400, message: "Missing tag" } }, 400);
  const tag = await d.one("SELECT id, label, slug FROM tags WHERE user_id = ? AND label = ?", [user.id, label]);
  if (!tag) return c.json({ error: { code: 404, message: "Tag not found" } }, 404);
  await d.run("DELETE FROM entry_tags WHERE tag_id = ?", [tag.id]);
  await d.run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tag.id, user.id]);
  return c.json(tag);
});

app.route("/api", api);

// Public feed URLs (auth via ?token=<feed_token>, mounted outside auth middleware
// so RSS readers that can't send Bearer headers can fetch them).
app.route("/api/feeds", feedPublicRoutes());

// Share pages are public
app.route("/share", shareRoutes());
