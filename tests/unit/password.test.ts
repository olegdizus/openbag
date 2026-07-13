import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../worker/src/auth";

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
});
