import { D1Client } from "@wallabag/core";

export async function findClient(env: any, clientId: string, clientSecret: string) {
  const db = new D1Client(env.DB);
  const parts = clientId.split("_");
  const numericId = parseInt(parts[0]);
  if (isNaN(numericId)) return null;
  return db.one(
    "SELECT id, user_id, random_id FROM oauth_clients WHERE id = ? AND secret = ?",
    [numericId, clientSecret]
  );
}
