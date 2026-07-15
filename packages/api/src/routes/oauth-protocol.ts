import { Hono } from "hono";
import {
  D1Client,
  randomHex,
  findClient,
  createAccessToken,
  createRefreshToken,
  passwordGrant,
  refreshTokenGrant,
  exchangeAuthCode,
  findUserByUsername,
} from "@openbag/core";

export function authRoutes() {
  const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: { id: number; username: string } } }>();

  // Wallabag-compatible token endpoint
  app.post("/oauth/v2/token", async (c) => {
    const contentType = c.req.header("content-type") || "";
    const body = contentType.includes("application/x-www-form-urlencoded")
      ? await c.req.parseBody()
      : await c.req.json<Record<string, any>>();
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const grantType = str(body.grant_type);
    const clientId = str(body.client_id);
    const clientSecret = str(body.client_secret);
    const username = str(body.username);
    const password = str(body.password);
    const refreshToken = str(body.refresh_token);
    const code = str(body.code);
    const redirectUri = str(body.redirect_uri);

    if (!grantType || !clientId || !clientSecret) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const client = await findClient(c.env, clientId, clientSecret);
    if (!client) {
      return c.json({ error: "invalid_client" }, 401);
    }

    let userId: number;
    try {
      switch (grantType) {
        case "password":
          if (!username || !password) return c.json({ error: "invalid_grant" }, 400);
          userId = await passwordGrant(c.env, username, password);
          break;
        case "refresh_token": {
          if (!refreshToken) return c.json({ error: "invalid_grant" }, 400);
          const row = await refreshTokenGrant(c.env, refreshToken);
          if (!row) return c.json({ error: "invalid_grant" }, 400);
          userId = row.user_id;
          break;
        }
        case "authorization_code": {
          if (!code) return c.json({ error: "invalid_grant" }, 400);
          const row = await exchangeAuthCode(c.env, code);
          if (!row) return c.json({ error: "invalid_grant" }, 400);
          userId = row.user_id;
          break;
        }
        case "token": {
          // Legacy implicit grant — use admin user
          const user = await findUserByUsername(c.env, "admin");
          if (!user) return c.json({ error: "invalid_grant" }, 400);
          userId = user.id;
          break;
        }
        default:
          return c.json({ error: "unsupported_grant_type" }, 400);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid credentials";
      return c.json({ error: message }, 400);
    }

    const accessToken = await createAccessToken(c.env, userId, client.id);
    const refreshTokenOut = await createRefreshToken(c.env, userId, client.id);
    return c.json({
      access_token: accessToken,
      expires_in: 3600,
      refresh_token: refreshTokenOut,
      scope: null,
      token_type: "bearer",
    });
  });

  // Browser authorization endpoint (auth code flow)
  app.get("/oauth/v2/auth", async (c) => {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");

    if (!clientId || responseType !== "code") {
      return c.html("<h1>Invalid request</h1>", 400);
    }

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Authorize</title></head>
        <body>
          <h1>Authorize application?</h1>
          <form method="post" action="/oauth/v2/auth/approve">
            <input type="hidden" name="client_id" value="${clientId}"/>
            <input type="hidden" name="redirect_uri" value="${redirectUri || ""}"/>
            <button type="submit">Approve</button>
          </form>
        </body>
      </html>
    `);
  });

  app.post("/oauth/v2/auth/approve", async (c) => {
    const body = await c.req.parseBody();
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";

    const client = await findClient(c.env, clientId, "");
    if (!client) {
      return c.html("<h1>Client not found</h1>", 404);
    }

    const user = await findUserByUsername(c.env, "admin");
    if (!user) return c.html("<h1>Admin user not found</h1>", 500);
    const authCode = randomHex(48);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const db = new D1Client(c.env.DB);
    await db.run(
      "INSERT INTO oauth_auth_codes (client_id, user_id, token, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)",
      [client.id, user.id, authCode, redirectUri, expiresAt]
    );

    const url = new URL(redirectUri || "/");
    url.searchParams.set("code", authCode);
    return c.redirect(url.toString(), 302);
  });

  return app;
}
