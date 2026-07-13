import { describe, it, expect } from "vitest";
import { isRegistrationEnabled } from "../../worker/src";
import type { Env } from "../../worker/src";

const env = (v: string | undefined): Env =>
  ({ DB: {} as D1Database, ALLOWED_REGISTRATION: v }) as Env;

describe("isRegistrationEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(isRegistrationEnabled(env(undefined))).toBe(true);
  });

  it("is enabled for truthy values", () => {
    expect(isRegistrationEnabled(env("true"))).toBe(true);
    expect(isRegistrationEnabled(env("TRUE"))).toBe(true);
    expect(isRegistrationEnabled(env("yes"))).toBe(true);
    expect(isRegistrationEnabled(env("1"))).toBe(true);
    expect(isRegistrationEnabled(env("anything"))).toBe(true);
  });

  it("is disabled for 'false', '0', and empty string", () => {
    expect(isRegistrationEnabled(env("false"))).toBe(false);
    expect(isRegistrationEnabled(env("FALSE"))).toBe(false);
    expect(isRegistrationEnabled(env("  false  "))).toBe(false);
    expect(isRegistrationEnabled(env("0"))).toBe(false);
    expect(isRegistrationEnabled(env(""))).toBe(false);
    expect(isRegistrationEnabled(env("   "))).toBe(false);
  });
});
