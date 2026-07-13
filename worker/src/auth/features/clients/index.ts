import { D1Client, randomHex } from "../../../index";

export async function findClient(env: any, clientId: string, clientSecret: string) {
  const db = new D1Client(env.DB);
  const parts = clientId.split("_");
  const numericId = parseInt(parts[0]);
  if (isNaN(numericId)) return null;
  return db.one(
    "SELECT id, user_id, random_id, secret, allowed_grant_types, redirect_uris FROM oauth_clients WHERE id = ? AND secret = ?",
    [numericId, clientSecret]
  );
}

export async function createClient(env: any, userId: number, name: string, redirectUris: string[], allowedGrantTypes: string[]) {
  const db = new D1Client(env.DB);
  const randomId = randomHex(32);
  const secret = randomHex(32);
  const result = await db.run(
    "INSERT INTO oauth_clients (user_id, random_id, secret, name, redirect_uris, allowed_grant_types) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, randomId, secret, name, JSON.stringify(redirectUris), JSON.stringify(allowedGrantTypes)]
  );
  const id = result.lastRowId;
  return { id, random_id: randomId, secret, name, redirect_uris: redirectUris, allowed_grant_types: allowedGrantTypes };
}

export async function listClients(env: any, userId: number) {
  const db = new D1Client(env.DB);
  return db.all(
    "SELECT id, random_id, secret, name, redirect_uris, allowed_grant_types, created_at FROM oauth_clients WHERE user_id = ?",
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
