import { D1Client } from "@wallabag/core";

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  const buf = new Uint8Array(salt.length + bits.byteLength);
  buf.set(salt);
  buf.set(new Uint8Array(bits), salt.length);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, hashHex: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bytes = new Uint8Array(hashHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
  const salt = bytes.slice(0, 16);
  const expected = bytes.slice(16);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  const derived = new Uint8Array(bits);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

export async function createUser(env: any, username: string, password: string) {
  const db = new D1Client(env.DB);
  const passwordHash = await hashPassword(password);
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
