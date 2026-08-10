import { describe, it, expect } from "vitest";
import { isRegistrationEnabled } from "@openbag/core";

const env = (v: string | undefined): any =>
  ({ DB: {} as D1Database, ALLOWED_REGISTRATION: v });

describe("isRegistrationEnabled", () => {
  it("defaults to DISABLED when unset (fail-closed, H4)", () => {
    expect(isRegistrationEnabled(env(undefined))).toBe(false);
    expect(isRegistrationEnabled({} as any)).toBe(false);
  });

  it("is enabled only for affirmative values", () => {
    expect(isRegistrationEnabled(env("true"))).toBe(true);
    expect(isRegistrationEnabled(env("TRUE"))).toBe(true);
    expect(isRegistrationEnabled(env("yes"))).toBe(true);
    expect(isRegistrationEnabled(env("1"))).toBe(true);
    expect(isRegistrationEnabled(env("on"))).toBe(true);
  });

  it("is disabled for 'false', '0', empty, and whitespace", () => {
    expect(isRegistrationEnabled(env("false"))).toBe(false);
    expect(isRegistrationEnabled(env("FALSE"))).toBe(false);
    expect(isRegistrationEnabled(env("  false  "))).toBe(false);
    expect(isRegistrationEnabled(env("0"))).toBe(false);
    expect(isRegistrationEnabled(env(""))).toBe(false);
    expect(isRegistrationEnabled(env("   "))).toBe(false);
    expect(isRegistrationEnabled(env("no"))).toBe(false);
    expect(isRegistrationEnabled(env("off"))).toBe(false);
  });
});
