import { Hono } from "hono";
import { entryRoutes } from "./features/entries";
import { tagRoutes } from "./features/tags";
import { annotationRoutes } from "./features/annotations";
import { searchRoutes } from "./features/search";
import { configRoutes } from "./features/config";
import { taggingRuleRoutes } from "./features/tagging-rules";
import { importRoutes } from "./features/import";
import { userRoutes } from "./features/users";
import { shareRoutes } from "./features/share";
import { authRoutes } from "@wallabag/auth";
import { corsMiddleware, loggingMiddleware, errorMiddleware, authMiddleware } from "@wallabag/core";

export const app = new Hono();

// Global middleware
app.use("*", corsMiddleware());
app.use("*", loggingMiddleware());
app.use("*", errorMiddleware());

// Public routes (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/version", (c) => c.text("2.5.0"));
app.get("/api/info", (c) => c.json({ appname: "Wallabag CF Worker", version: "0.1.0", allowed_registration: true }));

// Mount auth routes (OAuth2)
app.route("/", authRoutes());

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

// DELETE /api/tag/label — singular "tag" path, Wallabag compat
api.delete("/tag/label", async (c: any) => {
  const user = c.get("user");
  const { D1Client } = await import("@wallabag/core");
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

// Share pages are public
app.route("/share", shareRoutes());
