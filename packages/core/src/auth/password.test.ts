import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@openbag/core";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("the right one");
    expect(await verifyPassword("the wrong one", hash)).toBe(false);
  });

  it("produces unique salts (different hashes for same password)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("returns false for a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-real-hex")).toBe(false);
  });

  it("still verifies legacy bare-hex (100k) hashes — no silent lockout on upgrade", async () => {
    // Construct a genuine legacy hash: bare hex of salt||derived at 100k
    // (the pre-versioning format), with no `<iters>$` prefix.
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", enc.encode("legacy-pw"), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256,
    ));
    const buf = new Uint8Array(salt.length + bits.length);
    buf.set(salt); buf.set(bits, salt.length);
    const legacy = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");

    expect(await verifyPassword("legacy-pw", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });

  it("new hashes use the versioned 600k format", async () => {
    const h = await hashPassword("x");
    expect(h.startsWith("600000$")).toBe(true);
  });
});
