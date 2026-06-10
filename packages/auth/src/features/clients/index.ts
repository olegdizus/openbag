import { D1Client } from "@wallabag/core/db";

export async function createClient(env: any, userId: number, name: string) {
  const db = new D1Client(env.DB);
  const randomId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const secret = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await db.run(
    "INSERT INTO oauth_clients (user_id, random_id, secret, name) VALUES (?, ?, ?, ?)",
    [userId, randomId, secret, name]
  );
  return {
    id: `${userId}_${randomId}`,
    secret,
    name,
    redirect_uris: [],
    allowed_grant_types: ["token", "authorization_code", "password", "refresh_token"],
  };
}

export async function listClients(env: any, userId: number) {
  const db = new D1Client(env.DB);
  return db.all(
    "SELECT id, user_id, random_id, name, redirect_uris, allowed_grant_types, created_at FROM oauth_clients WHERE user_id = ?",
    [userId]
  );
}
