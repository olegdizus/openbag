import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";

const db = (env: any) => new D1Client(env.DB);

export const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));
