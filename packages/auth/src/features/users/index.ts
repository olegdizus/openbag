import { D1Client } from "@wallabag/core/db";
import bcrypt from "bcryptjs";

export async function createUser(env: any, username: string, password: string) {
  const db = new D1Client(env.DB);
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.run(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    [username, passwordHash]
  );
  const id = result.changes ?? (await db.one("SELECT last_insert_rowid() as id", [])).id;
  await db.run("INSERT INTO user_config (user_id) VALUES (?)", [id]);
  return id;
}

export async function findUserByUsername(env: any, username: string) {
  const db = new D1Client(env.DB);
  return db.one("SELECT id, username, password_hash FROM users WHERE username = ?", [username]);
}

export async function getUserInfo(env: any, userId: number) {
  const db = new D1Client(env.DB);
  return db.one("SELECT id, username, email, name, created_at FROM users WHERE id = ?", [userId]);
}
