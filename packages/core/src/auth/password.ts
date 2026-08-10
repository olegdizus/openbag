// PBKDF2/SHA-256 password hashing. Versioned: new hashes carry an
// `iterations$hex(salt||bits)` prefix and use 600k iterations (OWASP 2023
// minimum for PBKDF2-HMAC-SHA256). Legacy bare-hex hashes (the former 100k
// format) still verify, so existing rows keep working until the user next
// sets a password — at which point they silently upgrade to 600k.

const ITERATIONS = 600_000; // current guidance; legacy hashes verified at 100k
const LEGACY_ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

/**
 * Valid-format throwaway hash (all-zero salt + bits). Used to keep `verify`
 * timing constant on a username miss — runs the full PBKDF2 so a nonexistent
 * user responds just as slowly as a real one (defeats username enumeration).
 */
export const DUMMY_HASH = `${ITERATIONS}$${"00".repeat(SALT_BYTES + KEY_BITS / 8)}`;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function derive(password: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key, KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a password. Returns `<iterations>$<hex(salt||bits)>`.
 * Pure Web Crypto — runs in Workers and Node 20+ (scripts/create-user.ts).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, ITERATIONS);
  const buf = new Uint8Array(salt.length + derived.length);
  buf.set(salt);
  buf.set(derived, salt.length);
  return `${ITERATIONS}$${toHex(buf)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Versioned `<iters>$<hex>` (current) vs bare `<hex>` (legacy 100k).
  let iterations: number;
  let hexPart: string;
  const dollar = stored.indexOf("$");
  if (dollar > 0) {
    const parsed = parseInt(stored.slice(0, dollar), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return false;
    iterations = parsed;
    hexPart = stored.slice(dollar + 1);
  } else {
    iterations = LEGACY_ITERATIONS;
    hexPart = stored;
  }

  const bytes = fromHex(hexPart);
  // Salt is the leading SALT_BYTES; the rest is the expected derived bits.
  if (bytes.length < SALT_BYTES + (KEY_BITS / 8)) return false;
  const salt = bytes.slice(0, SALT_BYTES);
  const expected = bytes.slice(SALT_BYTES, SALT_BYTES + KEY_BITS / 8);
  const derived = await derive(password, salt, iterations);

  // Constant-time compare.
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}
