/**
 * Content fetcher and parser for Cloudflare Workers.
 *
 * Uses fetch() + Cloudflare HTMLRewriter for fast metadata extraction,
 * then linkedom + @mozilla/readability for body content extraction.
 */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { sanitizeEntryHtml } from "../sanitize";

export interface ParsedContent {
  title: string;
  content: string;
  domainName: string;
  excerpt: string;
  previewPicture: string;
  authors: string;
  language: string;
  readingTime: number;
  mimeType: string;
  finalUrl: string;
}

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; WallabagCF/1.0; +https://wallabag.org)",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

/**
 * L2: follow redirects manually, re-running the SSRF guard on every Location
 * (the original check only covered the initial URL, so a 302 to
 * `169.254.169.254` or an internal name slipped through). Bounded to 5 hops;
 * relative Location values resolve against the current URL.
 */
async function fetchFollowingSafely(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, { redirect: "manual", headers: FETCH_HEADERS });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res; // malformed redirect — surface as-is
      current = new URL(loc, current).toString();
      const safe = assertSafeFetchUrl(current);
      if (!safe.ok) throw new Error(`Refused redirect: ${safe.reason}`);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export async function fetchAndParse(url: string): Promise<ParsedContent> {
  // SSRF guard (H2): only http(s), and refuse obvious internal/metadata
  // targets. On Workers the host resolves on Cloudflare's edge, but we still
  // block the well-known metadata/loopback/private hostnames as defense in
  // depth and to avoid acting as an open proxy to internal names. Redirect
  // targets are re-checked in fetchFollowingSafely (L2).
  const safe = assertSafeFetchUrl(url);
  if (!safe.ok) throw new Error(`Refused URL: ${safe.reason}`);

  const res = await fetchFollowingSafely(url);

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "text/html";
  const finalUrl = res.url || url;
  const html = await res.text();

  const parsed = await parseHtml(html, finalUrl, contentType);
  // Enforce the same sanitization invariant as the user-content save paths:
  // fetched HTML is stored raw in entries.content (rendered on /share and the
  // reading view), so it MUST be sanitized here — the fetcher's internal
  // cleaners (stripAttributes/cleanHtml) are weaker (double-quote-only on*
  // stripping, no URL-scheme filter, no banned-tag drop on the Readability path).
  parsed.content = sanitizeEntryHtml(parsed.content);
  return parsed;
}

/**
 * Parse HTML into structured article content.
 * Pass 1: HTMLRewriter for metadata (title, og:*, lang, canonical).
 * Pass 2: linkedom + Readability for body content, excerpt, byline.
 */
// ponytail: hostname-based SSRF guard. Catches private/loopback IP literals
// in any encoding (decimal/hex/octal/IPv6-mapped) but NOT DNS rebinding (a
// domain that resolves to a private IP). On Workers that residual is bounded
// by CF egress having no route to RFC1918 space; if this ever fronts a
// non-Workers deployment with private-network reach, add a DoH pre-flight.
function assertSafeFetchUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { ok: false, reason: "invalid URL" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `scheme '${parsed.protocol}' not allowed` };
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateTarget(host)) {
    return { ok: false, reason: "private/loopback address refused" };
  }
  // Well-known cloud metadata endpoints (by hostname).
  if (host === "metadata.google.internal" || host === "metadata" || host === "metadata.azure.com") {
    return { ok: false, reason: "metadata endpoint refused" };
  }
  return { ok: true };
}

/** True if `host` is a private/loopback/link-local/CGNAT IP literal in any
 *  common encoding (dotted decimal, single decimal int, hex, octal, IPv6). */
export function isPrivateTarget(host: string): boolean {
  const h = host.replace(/^\[|]$/g, ""); // strip IPv6 brackets
  if (!h) return false;
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;        // IPv6 link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;    // IPv6 unique-local
    const mapped = h.match(/ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i); // ::ffff:a.b.c.d
    if (mapped && privateIPv4(mapped[1])) return true;
    const compat = h.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);     // ::a.b.c.d
    if (compat && privateIPv4(compat[1])) return true;
    return false;
  }
  const octets = parseIPv4(h);
  return octets ? privateIPv4(octets.join(".")) : false;
}

/** Parse an IPv4 host in any single encoding to 4 octets, or null. */
function parseIPv4(host: string): number[] | null {
  const tok = (t: string): number | null => {
    if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
    if (/^0[0-7]+$/.test(t)) return parseInt(t.slice(1), 8);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return null;
  };
  if (!host.includes(".")) {
    const n = tok(host);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(tok);
  if (octets.some((o) => o === null || (o as number) > 255)) return null;
  return octets as number[];
}

function privateIPv4(dotted: string): boolean {
  const o = dotted.split(".").map((n) => parseInt(n, 10));
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return false;
  const [a, b] = o;
  return (
    a === 0 ||                              // 0.0.0.0/8
    a === 10 ||                             // 10.0.0.0/8
    a === 127 ||                            // 127.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) ||             // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
    (a === 192 && b === 168)                // 192.168.0.0/16
  );
}

export async function parseHtml(html: string, url: string, contentType: string = "text/html"): Promise<ParsedContent> {
  const domainName = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();

  // Metadata via HTMLRewriter.
  let title = "";
  let h1 = "";
  let metaDescription = "";
  let ogImage = "";
  let ogTitle = "";
  let authorMeta = "";
  let langAttr = "";
  let canonicalUrl = "";

  const metaRewriter = new HTMLRewriter()
    .on("title", {
      text(el: { text: string }) { title += el.text; },
    })
    .on("h1", {
      text(el: { text: string }) { if (!h1) h1 += el.text; },
    })
    .on("meta[name='description' i]", {
      element(el: { getAttribute: (s: string) => string | null }) {
        metaDescription = el.getAttribute("content") || "";
      },
    })
    .on("meta[name='author' i]", {
      element(el: { getAttribute: (s: string) => string | null }) {
        authorMeta = el.getAttribute("content") || "";
      },
    })
    .on("meta[property='og:image' i]", {
      element(el: { getAttribute: (s: string) => string | null }) {
        ogImage = el.getAttribute("content") || "";
      },
    })
    .on("meta[property='og:title' i]", {
      element(el: { getAttribute: (s: string) => string | null }) {
        ogTitle = el.getAttribute("content") || "";
      },
    })
    .on("html", {
      element(el: { getAttribute: (s: string) => string | null }) {
        langAttr = el.getAttribute("lang") || "";
      },
    })
    .on("link[rel='canonical' i]", {
      element(el: { getAttribute: (s: string) => string | null }) {
        canonicalUrl = el.getAttribute("href") || "";
      },
    });

  // CRITICAL: HTMLRewriter is a *streaming* transformer — its element/text
  // handlers fire as the transformed Response body is consumed, not when
  // .transform() is called. If the returned Response is never read, the
  // Workers runtime may drain it lazily (or skip chunks under CPU pressure),
  // leaving every captured variable at its initial empty string. This was the
  // root cause of titles silently coming back as "" in production after
  // entries timed out / were killed. Awaiting .text() fully drains the stream
  // so every handler has run before we read the captured variables below.
  await metaRewriter.transform(new Response(html)).text();

  // Body via linkedom + Readability.
  let content = "";
  let excerpt = "";
  let byline = "";
  let contentTextLen = 0;

  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as any, { charThreshold: 200 }).parse();
    if (article) {
      content = article.content || "";
      excerpt = article.excerpt || "";
      byline = article.byline || "";
      contentTextLen = article.length || 0;
    }
  } catch {
    // Readability may throw on malformed/edge-case pages — fall back below
  }

  // Regex fallback when Readability returned nothing.
  let usedReadability = !!content && contentTextLen >= 100;
  if (!usedReadability) {
    content = extractArticleContent(html);
  }

  // Readability splits `<br /><br />`-separated pages into orphan-bracket
  // <p>s; rejoin them here (no-op when Readability didn't run).
  content = repairSplitParagraphs(content);

  // The regex fallback wasn't pre-sanitized, so it gets the aggressive clean.
  content = usedReadability ? stripAttributes(content) : cleanHtml(content);

  if (!title.trim() && ogTitle) title = ogTitle;
  if (!title.trim() && h1.trim()) title = h1;
  const finalTitle = title.trim();

  // ~200 wpm: conservative end of average adult silent reading speed for
  // non-technical prose (commonly cited 200–300 wpm). Standard baseline for
  // read-it-later apps and the implicit default behind Wallabag's
  // `reading_speed` user-config multiplier (=1).
  const plainText = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const wordCount = (contentTextLen || plainText.split(/\s+/).filter(Boolean).length);
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const finalExcerpt = metaDescription || excerpt || plainText.slice(0, 200).trim();

  const finalAuthors = authorMeta || byline;

  const language = langAttr || detectLanguage(plainText);

  return {
    title: finalTitle,
    content,
    domainName,
    excerpt: finalExcerpt,
    previewPicture: ogImage,
    authors: finalAuthors,
    language,
    readingTime,
    mimeType: contentType.split(";")[0].trim(),
    finalUrl: canonicalUrl || url,
  };
}

/** Run only when Readability produces nothing. */
function extractArticleContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  body = body.replace(/<(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)>/gi, "");
  return body;
}

/** Applied to Readability output (already structurally clean — only attr cleanup needed). */
function stripAttributes(html: string): string {
  let clean = html;
  clean = clean.replace(/\s+on\w+="[^"]*"/gi, "");
  clean = clean.replace(/\s+class="[^"]*"/gi, "");
  clean = clean.replace(/\s+style="[^"]*"/gi, "");
  clean = clean.replace(/\s+data-[a-z-]+="[^"]*"/gi, "");
  return clean.trim();
}

/** Used for the regex-fallback path (raw HTML — no Readability curation). */
function cleanHtml(html: string): string {
  let clean = html;
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  clean = clean.replace(/<!--[\s\S]*?-->/g, "");
  clean = clean.replace(/<(?:nav|header|footer|aside)[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, "");
  clean = clean.replace(/\s+on\w+="[^"]*"/gi, "");
  clean = clean.replace(/\s+class="[^"]*"/gi, "");
  clean = clean.replace(/\s+style="[^"]*"/gi, "");
  clean = clean.replace(/\s+data-[a-z-]+="[^"]*"/gi, "");
  clean = clean.replace(/\n{3,}/g, "\n\n");
  return clean.trim();
}

/**
 * Repair broken paragraph splits that Readability introduces on pages that
 * separate blocks with `<br /><br />` while wrapping inline elements.
 *
 * Symptom: Readability splits such blocks at boundaries where there is text on
 * one side and an inline element on the other with no whitespace between them.
 * For sources like paulgraham.com essays — `[<a name="f1n">1</a>] note text` —
 * this isolates stray brackets like `[` into their own <p> and orphans the
 * following `<a>1</a>]` and the note text into a separate <p>. The rendered
 * output then looks like:
 *
 *     [
 *     [1]()] note text
 *     [
 *
 * (the bogus `[1]()` happens when downstream tools convert a name-only `<a>`
 * to markdown link syntax with an empty href). Re-joining the fragments before
 * they are stored eliminates that artifact at the source.
 *
 * The repair merges a paragraph whose only content is one bracket-like
 * character (`[` or `{`) into the immediately following sibling paragraph, so
 * the bracket sits next to the content that was meant to follow it. The match
 * is intentionally narrow (single bracket, no other text) to avoid corrupting
 * legitimate `<p>[footnote text]</p>` blocks.
 */
function repairSplitParagraphs(html: string): string {
  // Match: <p>…</p> whose entire inner text is one "[" (or "{", also commonly
  // orphaned), followed by another sibling paragraph that begins with the
  // matching close anchor (`<a ...>N</a>]`, or any text starting with `<a>`).
  // Replace both paragraphs by merging: `<p>${bracket}${restOfNextP}`.
  // Iterate defensively in case nested splits stack up.
  const singleBracketRe = /<p[^>]*>\s*(\[|\{)\s*<\/p>\s*<p([^>]*)>/gi;
  let prev: string;
  let out = html;
  // Limit iterations to avoid pathological loops on adversarial input.
  for (let i = 0; i < 5; i++) {
    prev = out;
    out = out.replace(singleBracketRe, (_full, bracket: string, nextAttrs: string) => {
      // Drop the now-empty first <p>, splice the bracket into the next <p>
      // right after its opening tag.
      return `<p${nextAttrs}>${bracket}`;
    });
    if (out === prev) break;
  }
  return out;
}

function detectLanguage(text: string): string {
  const lower = text.toLowerCase().slice(0, 500);
  if (/\b(the|and|is|are|was|were|have|has|been|will|would|could|should)\b/.test(lower)) return "en";
  if (/\b(le|la|les|de|des|du|un|une|est|sont|avoir|fait)\b/.test(lower)) return "fr";
  if (/\b(el|la|los|las|de|en|es|son|está|tiene|por|con)\b/.test(lower)) return "es";
  if (/\b(der|die|das|und|ist|ein|eine|hat|sind|auf|mit|nicht)\b/.test(lower)) return "de";
  if (/\b(il|lo|la|le|gli|di|da|in|che|è|per|un)\b/.test(lower)) return "it";
  if (/\b(и|в|на|с|что|это|как|не|по|к)\b/.test(lower)) return "ru";
  return "en";
}
