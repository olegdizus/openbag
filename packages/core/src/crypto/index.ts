/** Hex codec + CSPRNG helpers shared across packages. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * sha256 hex of an opaque secret (OAuth bearer/refresh/auth-code tokens).
 * Only the hash is persisted, so a D1 leak cannot forge a usable token —
 * mirrors the session table's `token_hash` design. Callers store this hash
 * and return the raw `token` to the client exactly once.
 */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}
