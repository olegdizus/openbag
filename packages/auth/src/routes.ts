import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";
import { createClient, listClients } from "./features/clients";
import { createAccessToken, createRefreshToken, findAccessToken } from "./features/tokens";
import { passwordGrant, refreshTokenGrant, exchangeAuthCode } from "./features/grants";
import { createUser, findUserByUsername, getUserInfo } from "./features/users";
import bcrypt from "bcryptjs";

const db = (env: any) => new D1Client(env.DB);

export function authRoutes() {
  const app = new Hono();

  app.post("/oauth/v2/token", async (c) => {
    const body = await c.req.parseBody();
    const grantType = (body.grant_type as string) || "";
    const clientId = (body.client_id as string) || "";
    const clientSecret = (body.client_secret as string) || "";
    const username = body.username as string | undefined;
    const password = body.password as string | undefined;
    const refreshToken = body.refresh_token as string | undefined;
    const code = body.code as string | undefined;

    const client = await db(c.env).one(
      "SELECT id, user_id FROM oauth_clients WHERE random_id = ? AND secret = ?",
      [clientId, clientSecret]
    );

    if (!client) {
      return c.json({ error: { code: 400, message: "Invalid client credentials" } }, 400);
    }

    try {
      let userId: number;

      if (grantType === "password" && username && password) {
        userId = await passwordGrant(c.env, username, password);
      } else if (grantType === "refresh_token" && refreshToken) {
        const row = await refreshTokenGrant(c.env, refreshToken);
        userId = row.user_id;
      } else if (grantType === "authorization_code" && code) {
        const row = await exchangeAuthCode(c.env, code);
        userId = row.user_id;
      } else {
        return c.json({ error: { code: 400, message: "Unsupported grant type" } }, 400);
      }

      const accessToken = await createAccessToken(c.env, userId, client.id);
      const refreshTokenStr = await createRefreshToken(c.env, userId, client.id);

      return c.json({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: refreshTokenStr,
        scope: null,
        token_type: "bearer",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      return c.json({ error: { code: 401, message } }, 401);
    }
  });

  return app;
}
