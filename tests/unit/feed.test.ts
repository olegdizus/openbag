import { describe, it, expect } from "vitest";
import {
  __testBuildAtom,
  __testBuildRss,
} from "../../packages/api/src/features/feed";

// The feed module exports builders indirectly; we re-expose them via the
// `__test*` namespace below to keep the public surface clean.

describe("feed/Atom builder", () => {
  it("emits a valid Atom 1.0 document with entries", () => {
    const xml = __testBuildAtom({
      baseUrl: "https://bag.example",
      title: "alice's reading list",
      username: "alice",
      selfUrl: "https://bag.example/api/feeds/alice.atom?token=t",
      entries: [
        {
          id: 7,
          url: "https://article.example/1",
          title: '<script>"xss" & stuff',
          content: "<p>hi & bye</p>",
          published_at: "2026-07-05 08:00:00",
          created_at: "2026-07-05 09:00:00",
          updated_at: "2026-07-05 10:00:00",
        },
      ],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain("<updated>2026-07-05T10:00:00.000Z</updated>");
    // Atom text content only requires escaping &, <, > (quotes are fine).
    expect(xml).toContain("<title>&lt;script&gt;\"xss\" &amp; stuff</title>");
    expect(xml).toContain('<link rel="self" type="application/atom+xml"');
    expect(xml).toContain("<published>2026-07-05T08:00:00.000Z</published>");
  });

  it("emits a valid empty feed when there are no entries", () => {
    const xml = __testBuildAtom({
      baseUrl: "https://bag.example",
      title: "empty",
      username: "bob",
      selfUrl: "https://bag.example/api/feeds/bob.atom?token=t",
      entries: [],
    });
    expect(xml).not.toContain("<entry>");
    expect(xml).toContain("<author><name>bob</name></author>");
  });
});

describe("feed/RSS builder", () => {
  it("emits a valid RSS 2.0 document with items", () => {
    const xml = __testBuildRss({
      baseUrl: "https://bag.example",
      title: "alice's reading list",
      description: "Recent entries saved by alice",
      selfUrl: "https://bag.example/api/feeds/alice.xml?token=t",
      entries: [
        {
          id: 1,
          url: "https://article.example/1",
          title: "Hello & <world>",
          content: "<p>Body text</p>",
          created_at: "2026-07-05 09:00:00",
          updated_at: "2026-07-05 10:00:00",
        },
      ],
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Hello &amp; &lt;world&gt;</title>");
    expect(xml).toContain("<guid isPermaLink=\"false\">https://bag.example/api/entries/1</guid>");
    expect(xml).toContain("<pubDate>");
    expect(xml).toContain("<description>Body text</description>");
  });
});
