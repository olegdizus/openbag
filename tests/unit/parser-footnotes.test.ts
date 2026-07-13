import { describe, it, expect } from "vitest";
import { parseHtml } from "../../worker/src/parser";

// Regression for the broken footnote markup Readability produced on
// paulgraham.com/boss.html (and similar `<br /><br />`-separated pages that
// wrap inline elements). Without repair, the literal `[` got isolated into
// its own <p>, which rendered as `[\n[1]() note text\n[` and confused
// downstream HTML-to-Markdown converters into emitting `[1]()` link syntax.
describe("parseHtml — repairSplitParagraphs", () => {
  it("merges a stray '[' paragraph into the following footnote paragraph", async () => {
    // Shape that Readability emits for `[<a name="f1n"><font>1</font></a>] note…`
    // — the bracket ends up in its own <p>, and the bare inline <a> sits in the
    // next <p> with the note body, no whitespace around it.
    const before = `
<div id="readability-page-1"><div>
<p>Some preceding body text.</p>
<p>[</p>
<p><a name="f1n"><font color="#000000">1</font></a>]
When I talk about humans being meant or designed to live a
certain way, I mean by evolution.</p>
<p>[</p>
<p><a name="f2n"><font color="#000000">2</font></a>]
Second note body.</p>
</div></div>`;

    const out = (await parseHtml(before, "https://example.com/essay", "text/html")).content;

    // No isolated bracket paragraphs should remain.
    expect(out).not.toMatch(/<p[^>]*>\s*\[\s*<\/p>/i);

    // The bracket should sit immediately before the corresponding anchor,
    // inside the note's own <p>.
    expect(out).toMatch(/<p>\[<a name="f1n">/);
    expect(out).toMatch(/<p>\[<a name="f2n">/);

    // Both note bodies still present.
    expect(out).toContain("by evolution");
    expect(out).toContain("Second note body");
  });

  it("leaves intact paragraphs whose content is more than a single bracket", async () => {
    // A real "[1] Citation body" footnote must not be touched.
    const before = `<p>[1] Real footnote text.</p><p>[2] Another.</p>`;
    const out = (await parseHtml(before, "https://example.com/x", "text/html")).content;
    expect(out).toContain("[1] Real footnote text.");
    expect(out).toContain("[2] Another.");
  });

  it("also repairs '{' orphaned by the same splitter", async () => {
    const before = `
<p>{</p>
<p>fragmented} body text.</p>`;
    const out = (await parseHtml(before, "https://example.com/x", "text/html")).content;
    expect(out).not.toMatch(/<p[^>]*>\s*\{\s*<\/p>/i);
    expect(out).toContain("{fragmented}");
  });
});
