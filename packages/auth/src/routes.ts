import { Hono } from "hono";
import { findClient, createClient, listClients, deleteClient } from "./features/clients";
import { createAccessToken, createRefreshToken, findAccessToken, revokeAccessToken, revokeRefreshToken } from "./features/tokens";
import { passwordGrant, refreshTokenGrant, exchangeAuthCode } from "./features/grants";
import { findUserByUsername, createUser } from "./features/users";
import { D1Client } from "@wallabag/core";
import { sessionMiddleware } from "@wallabag/core";

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

type Env = {
  DB: D1Database;
};

export function authRoutes() {
  const app = new Hono<{ Bindings: Env; Variables: { user: { id: number; username: string } } }>();

  // Wallabag-compatible token endpoint
  app.post("/oauth/v2/token", async (c) => {
    const contentType = c.req.header("content-type") || "";
    let grantType: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let username: string | undefined;
    let password: string | undefined;
    let refreshToken: string | undefined;
    let code: string | undefined;
    let redirectUri: string | undefined;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await c.req.parseBody();
      grantType = typeof body.grant_type === "string" ? body.grant_type : undefined;
      clientId = typeof body.client_id === "string" ? body.client_id : undefined;
      clientSecret = typeof body.client_secret === "string" ? body.client_secret : undefined;
      username = typeof body.username === "string" ? body.username : undefined;
      password = typeof body.password === "string" ? body.password : undefined;
      refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : undefined;
      code = typeof body.code === "string" ? body.code : undefined;
      redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : undefined;
    } else {
      const body = await c.req.json<Record<string, any>>();
      grantType = body.grant_type;
      clientId = body.client_id;
      clientSecret = body.client_secret;
      username = body.username;
      password = body.password;
      refreshToken = body.refresh_token;
      code = body.code;
      redirectUri = body.redirect_uri;
    }

    if (!grantType || !clientId || !clientSecret) {
      return c.json({ error: "invalid_request" }, 400);
    }

    // Parse client id
    const parts = clientId.split("_");
    const numericId = parseInt(parts[0]);
    if (isNaN(numericId)) {
      return c.json({ error: "invalid_client" }, 401);
    }

    const client = await findClient(c.env, clientId, clientSecret);
    if (!client) {
      return c.json({ error: "invalid_client" }, 401);
    }

    let userId: number;
    let accessToken: string;
    let refreshTokenOut: string | undefined;

    try {
      switch (grantType) {
        case "password": {
          if (!username || !password) {
            return c.json({ error: "invalid_grant" }, 400);
          }
          userId = await passwordGrant(c.env, username, password);
          accessToken = await createAccessToken(c.env, userId, client.id);
          refreshTokenOut = await createRefreshToken(c.env, userId, client.id);
          break;
        }
        case "refresh_token": {
          if (!refreshToken) {
            return c.json({ error: "invalid_grant" }, 400);
          }
          const row = await refreshTokenGrant(c.env, refreshToken);
          if (!row) {
            return c.json({ error: "invalid_grant" }, 400);
          }
          userId = row.user_id;
          accessToken = await createAccessToken(c.env, userId, client.id);
          refreshTokenOut = await createRefreshToken(c.env, userId, client.id);
          break;
        }
        case "authorization_code": {
          if (!code) {
            return c.json({ error: "invalid_grant" }, 400);
          }
          const row = await exchangeAuthCode(c.env, code);
          if (!row) {
            return c.json({ error: "invalid_grant" }, 400);
          }
          userId = row.user_id;
          accessToken = await createAccessToken(c.env, userId, client.id);
          refreshTokenOut = await createRefreshToken(c.env, userId, client.id);
          break;
        }
        case "token": {
          // Legacy implicit grant — use admin user
          const user = await findUserByUsername(c.env, "admin");
          userId = user.id;
          accessToken = await createAccessToken(c.env, userId, client.id);
          refreshTokenOut = await createRefreshToken(c.env, userId, client.id);
          break;
        }
        default:
          return c.json({ error: "unsupported_grant_type" }, 400);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid credentials";
      return c.json({ error: message }, 400);
    }

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

    const parts = clientId.split("_");
    const numericId = parseInt(parts[0]);
    if (isNaN(numericId)) {
      return c.html("<h1>Invalid client</h1>", 400);
    }

    const client = await findClient(c.env, clientId, "");
    if (!client) {
      return c.html("<h1>Client not found</h1>", 404);
    }

    const user = await findUserByUsername(c.env, "admin");
    const authCode = randomToken(48);
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

  // Developer pages (web UI)
  app.use("/developer/*", sessionMiddleware());
  app.use("/developer", sessionMiddleware());
  app.get("/developer", async (c) => {
    const sessionUser = c.get("user");
    if (!sessionUser) return c.redirect("/login", 302);
    const clients = await listClients(c.env, sessionUser.id);
    const items = clients.map((cl: any) => {
      let redirectUris: string[] = [];
      let allowedGrantTypes: string[] = [];
      try { redirectUris = JSON.parse(cl.redirect_uris || "[]"); } catch {}
      try { allowedGrantTypes = JSON.parse(cl.allowed_grant_types || "[]"); } catch {}
      return {
        id: cl.id,
        client_id: `${cl.id}_${cl.random_id}`,
        client_secret: cl.secret,
        name: cl.name,
        redirect_uris: redirectUris,
        allowed_grant_types: allowedGrantTypes,
        created_at: cl.created_at,
      };
    });
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Developer</title>
          <style>
            body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
            nav { display: flex; gap: 16px; margin-bottom: 24px; align-items: center; }
            nav a { color: #2563eb; text-decoration: none; }
            .client-card { border: 1px solid #e5e7eb; padding: 16px; margin: 12px 0; border-radius: 8px; }
            .client-card h3 { margin: 0 0 12px; }
            .cred-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
            .cred-row code { background: #f1f5f9; padding: 6px 10px; border-radius: 4px; font-size: 13px; word-break: break-all; flex: 1; }
            .btn-sm { padding: 4px 10px; font-size: 13px; cursor: pointer; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; }
            .btn-sm:hover { background: #f9fafb; }
            .btn-danger { color: #dc2626; border-color: #fca5a5; }
            .btn-danger:hover { background: #fef2f2; }
            .btn-create { display: inline-block; padding: 8px 16px; background: #2563eb; color: white; text-decoration: none; border-radius: 4px; margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <nav>
            <strong>Wallabag CF</strong>
            <a href="/">Dashboard</a>
            <a href="/entries">Entries</a>
            <a href="/developer">Developer</a>
          </nav>
          <h1>OAuth Clients</h1>
          <a href="/developer/client/create" class="btn-create">+ Create new client</a>
          ${items.length === 0 ? '<p style="color:#999">No clients yet.</p>' : items.map((cl: any) => `
            <div class="client-card">
              <h3>${cl.name}</h3>
              <div class="cred-row">
                <strong style="min-width:100px">Client ID:</strong>
                <code>${cl.client_id}</code>
                <button class="btn-sm" onclick="navigator.clipboard.writeText('${cl.client_id}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500)">Copy</button>
              </div>
              <div class="cred-row">
                <strong style="min-width:100px">Client Secret:</strong>
                <code>${cl.client_secret}</code>
                <button class="btn-sm" onclick="navigator.clipboard.writeText('${cl.client_secret}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500)">Copy</button>
              </div>
              <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
                <form method="post" action="/developer/client/delete/${cl.id}" style="display:inline">
                  <button type="submit" class="btn-sm btn-danger">Delete</button>
                </form>
                ${cl.created_at ? '<span style="color:#999; font-size:13px">Created ' + new Date(cl.created_at).toLocaleDateString() + '</span>' : ''}
              </div>
            </div>
          `).join("")}
        </body>
      </html>
    `);
  });

  app.get("/developer/client/create", (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Create OAuth Client</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        </head>
        <body>
          <h1>Create OAuth Client</h1>
          <form method="post" action="/developer/client/create" hx-post="/developer/client/create" hx-target="body" hx-swap="outerHTML">
            <div>
              <label>Name: <input type="text" name="name" required/></label>
            </div>
            <div>
              <label>Redirect URIs (comma separated): <input type="text" name="redirect_uris" value="http://localhost"/></label>
            </div>
            <button type="submit">Create</button>
          </form>
          <p><a href="/developer">Back</a></p>
        </body>
      </html>
    `);
  });

  app.post("/developer/client/create", async (c) => {
    const body = await c.req.parseBody();
    const name = typeof body.name === "string" ? body.name : "Unnamed";
    const redirectUrisRaw = typeof body.redirect_uris === "string" ? body.redirect_uris : "http://localhost";
    const redirectUris = redirectUrisRaw.split(",").map(s => s.trim()).filter(Boolean);
    const allowedGrantTypes = ["token", "authorization_code", "password", "refresh_token"];
    const sessionUser = c.get("user");
    if (!sessionUser) return c.redirect("/login", 302);
    const client = await createClient(c.env, sessionUser.id, name, redirectUris, allowedGrantTypes);
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Client Created</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        </head>
        <body>
          <h1>Client Created</h1>
          <p><strong>Client ID:</strong> ${client.id}_${client.random_id}</p>
          <p><strong>Client Secret:</strong> ${client.secret}</p>
          <p>Store the secret securely — it will not be shown again.</p>
          <p><a href="/developer">Back to developers</a></p>
        </body>
      </html>
    `);
  });

  app.post("/developer/client/delete/:id", async (c) => {
    const sessionUser = c.get("user");
    if (!sessionUser) return c.redirect("/login", 302);
    const id = parseInt(c.req.param("id"));
    await deleteClient(c.env, sessionUser.id, id);
    return c.redirect("/developer", 302);
  });

  return app;
}
