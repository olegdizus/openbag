import { D1Client, isRegistrationEnabled } from "@openbag/core";
import { hashPassword, verifyPassword } from "./password";

export { hashPassword, verifyPassword };

export async function createUser(env: any, username: string, password: string, email?: string) {
  if (!isRegistrationEnabled(env)) throw new Error("REGISTRATION_DISABLED");
  const db = new D1Client(env.DB);
  const passwordHash = await hashPassword(password);
  const result = await db.run(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email || null, passwordHash]
  );
  const id = result.lastRowId;
  await db.run("INSERT INTO user_config (user_id) VALUES (?)", [id]);
  return id;
}

export async function findUserByUsername(env: any, username: string) {
  const db = new D1Client(env.DB);
  return db.one<{ id: number; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = ?",
    [username]
  );
}

export async function getUserInfo(env: any, userId: number) {
  const db = new D1Client(env.DB);
  return db.one("SELECT id, username, email, name, created_at FROM users WHERE id = ?", [userId]);
}

export async function verifyPasswordAgainst(env: any, username: string, password: string): Promise<boolean> {
  const user = await findUserByUsername(env, username);
  if (!user) return false;
  return verifyPassword(password, user.password_hash);
}
