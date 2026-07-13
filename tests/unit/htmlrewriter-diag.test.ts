import { describe, it, expect } from "vitest";
import { parseHtml } from "../../worker/src/parser";

// Diagnostic: ensure HTMLRewriter handlers fire at all in this Workers runtime
// test environment. If these all pass, title parsing itself is wired correctly.
describe("HTMLRewriter title diagnostics", () => {
  it("captures <title> text", async () => {
    const html = `<html><head><title>My Title</title></head><body><p>${"body ".repeat(50)}</p></body></html>`;
    const out = await parseHtml(html, "https://example.com/x", "text/html");
    expect(out.title).toBe("My Title");
  });

  it("captures og:title when no <title>", async () => {
    const html = `<html><head><meta property="og:title" content="OG Title"></head><body><p>${"body ".repeat(50)}</p></body></html>`;
    const out = await parseHtml(html, "https://example.com/x", "text/html");
    expect(out.title).toBe("OG Title");
  });

  it("captures first <h1> when no <title> and no og:title", async () => {
    const html = `<html><body><h1>Heading</h1><p>${"body ".repeat(50)}</p></body></html>`;
    const out = await parseHtml(html, "https://example.com/x", "text/html");
    expect(out.title).toBe("Heading");
  });
});
