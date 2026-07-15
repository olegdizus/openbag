import { describe, it, expect } from "vitest";
import { parseHtml } from "@openbag/core";

// Regression: HTMLRewriter is a streaming transformer — its handlers only fire
// as the transformed Response body is consumed. parseHtml used to call
// .transform() and discard the result, which meant the meta handlers fired
// lazily (or not at all) and metadata fields like title came back empty. After
// the fix, parseHtml awaits the transformed .text() so handlers are guaranteed
// to run before the captured variables are read.
describe("parseHtml — title extraction", () => {
  it("returns the page <title> when present, even with no <h1>", async () => {
    const html = `<html><head><title>You Weren't Meant to Have a Boss</title></head><body>${"<p>body text </p>".repeat(20)}</body></html>`;
    const out = await parseHtml(html, "https://paulgraham.com/boss.html", "text/html");
    expect(out.title).toBe("You Weren't Meant to Have a Boss");
  });

  it("falls back to og:title when <title> is absent", async () => {
    const html = `<html><head><meta property="og:title" content="OG Title Here"><meta property="og:image" content="https://x/y.png"></head><body>${"<p>body text </p>".repeat(20)}</body></html>`;
    const out = await parseHtml(html, "https://example.com/x", "text/html");
    expect(out.title).toBe("OG Title Here");
  });

  it("falls back to the first <h1> when neither <title> nor og:title exist", async () => {
    const body = "body text ".repeat(60);
    const html = `<html><body><h1>Heading One</h1><p>${body}</p></body></html>`;
    const out = await parseHtml(html, "https://example.com/x", "text/html");
    expect(out.title).toBe("Heading One");
  });
});
