import { D1Client } from "../db";
import { randomHex, tokenHash } from "../crypto";

export async function findClient(env: any, clientId: string, clientSecret: string) {
  const db = new D1Client(env.DB);
  const parts = clientId.split("_");
  const numericId = parseInt(parts[0]);
  if (isNaN(numericId)) return null;
  // Compare sha256(secret) — the raw secret is never stored, matching the
  // token/session design so a DB leak can't forge a confidential client.
  return db.one(
    "SELECT id, user_id, random_id, allowed_grant_types, redirect_uris FROM oauth_clients WHERE id = ? AND secret = ?",
    [numericId, await tokenHash(clientSecret)]
  );
}

export async function createClient(env: any, userId: number, name: string, redirectUris: string[], allowedGrantTypes: string[]) {
  const db = new D1Client(env.DB);
  const randomId = randomHex(32);
  const secret = randomHex(32); // raw — returned once below, hashed at rest
  const result = await db.run(
    "INSERT INTO oauth_clients (user_id, random_id, secret, name, redirect_uris, allowed_grant_types) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, randomId, await tokenHash(secret), name, JSON.stringify(redirectUris), JSON.stringify(allowedGrantTypes)]
  );
  const id = result.lastRowId;
  return { id, random_id: randomId, secret, name, redirect_uris: redirectUris, allowed_grant_types: allowedGrantTypes };
}

export async function listClients(env: any, userId: number) {
  const db = new D1Client(env.DB);
  // secret omitted — it's a hash at rest; the plaintext is shown once at creation.
  return db.all(
    "SELECT id, random_id, name, redirect_uris, allowed_grant_types, created_at FROM oauth_clients WHERE user_id = ?",
    [userId]
  );
}

export async function deleteClient(env: any, userId: number, clientId: number) {
  const db = new D1Client(env.DB);
  await db.run(
    "DELETE FROM oauth_clients WHERE id = ? AND user_id = ?",
    [clientId, userId]
  );
}
