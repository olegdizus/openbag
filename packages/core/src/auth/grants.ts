import { D1Client } from "../db";
import { verifyPassword } from "./password";

export async function passwordGrant(env: any, username: string, password: string) {
  const db = new D1Client(env.DB);
  const user = await db.one("SELECT id, password_hash FROM users WHERE username = ?", [username]);
  if (!user) throw new Error("Invalid credentials");
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error("Invalid credentials");
  return user.id;
}

export async function refreshTokenGrant(env: any, refreshToken: string) {
  const db = new D1Client(env.DB);
  const row = await db.one(
    "SELECT user_id, client_id FROM oauth_refresh_tokens WHERE token = ? AND expires_at > datetime('now')",
    [refreshToken]
  );
  return row;
}

export async function exchangeAuthCode(env: any, code: string) {
  const db = new D1Client(env.DB);
  const row = await db.one(
    "SELECT user_id, client_id FROM oauth_auth_codes WHERE token = ? AND expires_at > datetime('now')",
    [code]
  );
  await db.run("DELETE FROM oauth_auth_codes WHERE token = ?", [code]);
  return row;
}
