import { Hono } from "hono";

export function authRoutes() {
  const app = new Hono();

  app.post("/oauth/v2/token", (c) => {
    return c.json({
      access_token: "stub_token",
      expires_in: 3600,
      refresh_token: "stub_refresh",
      scope: null,
      token_type: "bearer",
    });
  });

  return app;
}
