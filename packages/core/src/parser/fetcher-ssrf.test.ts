import { describe, it, expect } from "vitest";
import { isPrivateTarget } from "@openbag/core";

// The SSRF guard must refuse private/loopback IPs in EVERY common encoding.
// A miss on any form (decimal/hex/octal/IPv6-mapped) silently re-opens the
// fetcher as an internal proxy — these are the regressions to catch.
describe("isPrivateTarget — encoding bypasses", () => {
  const blocked = [
    "127.0.0.1",
    "2130706433",          // 127.0.0.1 as a single decimal int
    "0x7f000001",          // hex
    "0177.0.0.1",          // octal per-octet
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",     // cloud metadata
    "0.0.0.0",
    "100.64.0.1",          // CGNAT
    "::1",
    "::",
    "fe80::1",
    "fd12:3456:789a::1",
    "[::ffff:127.0.0.1]",  // IPv6-mapped IPv4 (bracketed, as URL hostname gives)
    "::ffff:10.0.0.1",
  ];
  for (const h of blocked) {
    it(`blocks ${h}`, () => expect(isPrivateTarget(h)).toBe(true));
  }

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "example.com",
    "metadata.evil.com",   // hostname-based blocklist is separate; IP-only here
    "",
  ];
  for (const h of allowed) {
    it(`allows ${h || "(empty)"}`, () => expect(isPrivateTarget(h)).toBe(false));
  }
});
