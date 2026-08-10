import { Hono } from "hono";
import {
  findClient,
  createAccessToken,
  createRefreshToken,
  passwordGrant,
  refreshTokenGrant,
  exchangeAuthCode,
  isThrottled,
  recordLoginFailure,
  clearLoginFailures,
} from "@openbag/core";

function htmlEscape(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function authRoutes() {
  const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: { id: number; username: string } } }>();

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

    if (!grantType || !clientId || !clientSecret) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const client = await findClient(c.env, clientId, clientSecret);
    if (!client) {
      return c.json({ error: "invalid_client" }, 401);
    }
    // M1: honor the client's stored grant allowlist. A client created
    // restricted to authorization_code must not reach password/refresh.
    const rawGrants = client.allowed_grant_types;
    const allowedGrants = new Set<string>(
      Array.isArray(rawGrants) ? rawGrants : (() => { try { return JSON.parse(rawGrants || "[]"); } catch { return []; } })(),
    );
    if (!allowedGrants.has(grantType)) {
      return c.json({ error: "unauthorized_client" }, 400);
    }

    let userId: number;
    try {
      switch (grantType) {
        case "password":
          if (!username || !password) return c.json({ error: "invalid_grant" }, 400);
          { // M7: per-IP throttle bucket (CF-Connecting-IP)
            const ip = c.req.header("CF-Connecting-IP") ?? undefined;
            if (await isThrottled(c.env, username, ip)) {
              return c.json({ error: "invalid_grant" }, 400);
            }
            try {
              userId = await passwordGrant(c.env, username, password);
            } catch {
              await recordLoginFailure(c.env, username, ip);
              return c.json({ error: "invalid_grant" }, 400);
            }
            await clearLoginFailures(c.env, username);
          }
          break;
        case "refresh_token": {
          if (!refreshToken) return c.json({ error: "invalid_grant" }, 400);
          // Bound to the authenticated client (M2): a leaked refresh token only
          // redeems for its own client.
          const row = await refreshTokenGrant(c.env, refreshToken, client.id);
          if (!row) return c.json({ error: "invalid_grant" }, 400);
          userId = row.user_id;
          break;
        }
        case "authorization_code": {
          if (!code) return c.json({ error: "invalid_grant" }, 400);
          const row = await exchangeAuthCode(c.env, code, client.id);
          if (!row) return c.json({ error: "invalid_grant" }, 400);
          userId = row.user_id;
          break;
        }
        // Note: the implicit `token` grant was removed — it minted tokens for a
        // hardcoded "admin" user regardless of caller (C1, privilege escalation).
        // RFC 9700 deprecates implicit grant; clients should use `password` or
        // `authorization_code` (the latter needs a consent UI, see /oauth/v2/auth).
        default:
          return c.json({ error: "unsupported_grant_type" }, 400);
      }
    } catch {
      // Generic message — avoid leaking which field failed (also masks any
      // unexpected internal detail from the error middleware).
      return c.json({ error: "invalid_grant" }, 400);
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

  // Browser authorization endpoint (auth code flow). The consent/approve flow
  // is intentionally a safe stub — it does NOT mint codes until a real,
  // session-authenticated consent UI is implemented. All interpolated values
  // are HTML-escaped (H1: the old version reflected client_id/redirect_uri).
  app.get("/oauth/v2/auth", async (c) => {
    const clientId = htmlEscape(c.req.query("client_id") || "");
    const redirectUri = htmlEscape(c.req.query("redirect_uri") || "");
    const responseType = c.req.query("response_type");
    if (responseType !== "code") {
      return c.text("Invalid request: response_type must be 'code'", 400);
    }
    return c.html(`<!DOCTYPE html><html><head><title>Authorize</title></head><body>
      <h1>Authorize application</h1>
      <p>Client: ${clientId || "(unknown)"}</p>
      <p>Redirect: ${redirectUri || "(none)"}</p>
      <p>The authorization-code consent screen is not yet implemented.</p>
    </body></html>`);
  });

  return app;
}

// The former POST /oauth/v2/auth/approve endpoint was removed: it was dead
// code (findClient with an empty secret always 404'd) and would have issued
// admin auth codes with no authentication if "fixed" naively (M8). A real
// consent flow needs a session-authenticated UI + redirect_uri validation.
