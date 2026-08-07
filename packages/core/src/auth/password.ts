const ITERATIONS = 100000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/**
 * PBKDF2/SHA-256 password hash (100k iterations, 16-byte random salt). Pure
 * Web Crypto — safe to run in both the Cloudflare Workers runtime and Node 20+
 * (used by the out-of-band `scripts/create-user.ts` provisioning tool).
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key, KEY_BITS
  );
  const buf = new Uint8Array(salt.length + bits.byteLength);
  buf.set(salt);
  buf.set(new Uint8Array(bits), salt.length);
  return toHex(buf);
}

export async function verifyPassword(password: string, hashHex: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bytes = fromHex(hashHex);
  const salt = bytes.slice(0, SALT_BYTES);
  const expected = bytes.slice(SALT_BYTES);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key, KEY_BITS
  );
  const derived = new Uint8Array(bits);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}
