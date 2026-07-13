import { describe, it, expect } from "vitest";
import { sanitizeEntryHtml, computeReadingTime } from "../../worker/src";

describe("sanitizeEntryHtml — banned elements", () => {
  it("strips <script> blocks entirely", () => {
    const out = sanitizeEntryHtml('<p>hi</p><script>alert(1)</script><p>bye</p>');
    expect(out).toBe("<p>hi</p><p>bye</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("strips <style>, <iframe>, <object>, <embed>, <form> blocks", () => {
    const out = sanitizeEntryHtml(
      '<style>body{color:red}</style><iframe src="x"></iframe><object data="y"></object><embed src="z"><form><button>x</button></form><p>ok</p>',
    );
    expect(out).not.toContain("style");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("object");
    expect(out).not.toContain("embed");
    expect(out).not.toContain("form");
    expect(out).not.toContain("button");
    expect(out).toContain("<p>ok</p>");
  });

  it("strips self-closing / void banned tags", () => {
    const out = sanitizeEntryHtml('<meta http-equiv="refresh" content="0;url=x"><link rel="stylesheet" href="x"><p>a</p>');
    expect(out).not.toContain("meta");
    expect(out).not.toContain("link");
    expect(out).toContain("<p>a</p>");
  });

  it("strips stray / unclosed banned tags", () => {
    const out = sanitizeEntryHtml("text <script>alert(1) <p>after</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("strips HTML comments and CDATA", () => {
    const out = sanitizeEntryHtml("<p>a</p><!-- secret --><p>b</p>");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("--");
  });
});

describe("sanitizeEntryHtml — event handlers", () => {
  it("strips onclick/onerror/onload (double-quoted)", () => {
    const out = sanitizeEntryHtml('<img src="x.jpg" onclick="steal()" onerror="boom()">');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onerror");
    expect(out).toContain('src="x.jpg"');
  });

  it("strips single-quoted and unquoted handlers", () => {
    const out = sanitizeEntryHtml("<p onmouseover='x()' onload=foo()>t</p>");
    expect(out).not.toContain("onmouseover");
    expect(out).not.toContain("onload");
    expect(out).toContain("<p>t</p>");
  });

  it("strips any arbitrary on* attribute", () => {
    const out = sanitizeEntryHtml('<p ontoggle="x" onpointerdown="y">t</p>');
    expect(out).not.toContain("ontoggle");
    expect(out).not.toContain("onpointerdown");
  });
});

describe("sanitizeEntryHtml — dangerous URLs", () => {
  it("drops href with javascript: scheme", () => {
    const out = sanitizeEntryHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("href");
    expect(out).toContain("<a>x</a>");
  });

  it("drops src with javascript: scheme but keeps safe src", () => {
    const out = sanitizeEntryHtml('<img src="javascript:alert(1)"><img src="https://e/i.png">');
    expect(out).not.toContain("javascript");
    expect(out).toContain('src="https://e/i.png"');
  });

  it("drops entity-encoded javascript: scheme", () => {
    const out = sanitizeEntryHtml('<a href="javas&#99;ript:alert(1)">x</a>');
    expect(out).not.toMatch(/href=".*alert/);
    expect(out).not.toContain("javascript");
  });

  it("drops data:text/html and data:application/ schemes", () => {
    const out = sanitizeEntryHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain("data:");
  });

  it("keeps data:image/png (safe data URL)", () => {
    const out = sanitizeEntryHtml('<img src="data:image/png;base64,iVBOR=">');
    expect(out).toContain('src="data:image/png;base64,iVBOR="');
  });

  it("keeps relative, anchor, http(s), mailto URLs", () => {
    const html = '<a href="/path">a</a><a href="#sec">b</a><a href="https://x.com">c</a><a href="mailto:a@b.com">d</a>';
    expect(sanitizeEntryHtml(html)).toBe(html);
  });
});

describe("sanitizeEntryHtml — inline styles (restyle)", () => {
  it("keeps allowed style declarations", () => {
    const out = sanitizeEntryHtml('<p style="text-align: center; color: red">x</p>');
    expect(out).toContain("text-align: center");
    expect(out).toContain("color: red");
  });

  it("drops disallowed properties", () => {
    const out = sanitizeEntryHtml('<p style="position: fixed; top: 0; color: red">x</p>');
    expect(out).not.toContain("position");
    expect(out).not.toContain("top");
    expect(out).toContain("color: red");
  });

  it("strips url()/expression()/javascript: from style values", () => {
    const out = sanitizeEntryHtml('<p style="color: expression(alert(1)); background-color: url(javascript:1)">x</p>');
    expect(out).not.toContain("expression");
    expect(out).not.toContain("javascript");
    expect(out).toBe("<p>x</p>");
  });

  it("removes the style attribute entirely when nothing safe remains", () => {
    const out = sanitizeEntryHtml('<p style="position: absolute">x</p>');
    expect(out).toBe("<p>x</p>");
  });
});

describe("sanitizeEntryHtml — misc attributes", () => {
  it("strips class and id attributes", () => {
    expect(sanitizeEntryHtml('<p class="x" id="y">t</p>')).toBe("<p>t</p>");
  });

  it("strips data-* attributes", () => {
    expect(sanitizeEntryHtml('<p data-foo="bar">t</p>')).toBe("<p>t</p>");
  });

  it("strips srcset and srcdoc", () => {
    const out = sanitizeEntryHtml('<img src="a.jpg" srcset="a.jpg 1x"><iframe srcdoc="<p>x</p>"></iframe>');
    expect(out).not.toContain("srcset");
    expect(out).not.toContain("srcdoc");
  });

  it("preserves safe rich content (headings, lists, links, images)", () => {
    const html = '<h2>Title</h2><p>A <a href="https://e.com">link</a> and <strong>bold</strong>.</p><ul><li>one</li><li>two</li></ul><blockquote>quote</blockquote>';
    expect(sanitizeEntryHtml(html)).toBe(html);
  });

  it("collapses excessive blank lines", () => {
    const out = sanitizeEntryHtml("<p>a</p>\n\n\n\n<p>b</p>");
    expect(out).toBe("<p>a</p>\n\n<p>b</p>");
  });

  it("treats empty input as empty string", () => {
    expect(sanitizeEntryHtml("")).toBe("");
  });
});

describe("computeReadingTime", () => {
  it("is at least 1 minute", () => {
    expect(computeReadingTime("<p>short</p>")).toBe(1);
  });

  it("scales with word count (~200 wpm)", () => {
    const words = Array.from({ length: 450 }, (_, i) => "word" + i).join(" ");
    expect(computeReadingTime(`<p>${words}</p>`)).toBe(3);
  });

  it("strips tags and entities before counting", () => {
    expect(computeReadingTime("<p>&nbsp;&amp;</p>")).toBe(1);
  });
});
