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

export const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/", authRoutes());
app.route("/api/entries", entryRoutes());
app.route("/api/tags", tagRoutes());
app.route("/api/annotations", annotationRoutes());
app.route("/api/search", searchRoutes());
app.route("/api/config", configRoutes());
app.route("/api", taggingRuleRoutes());
app.route("/api", importRoutes());
app.route("/api", userRoutes());
app.route("/", shareRoutes());
