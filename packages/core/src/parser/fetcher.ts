/**
 * Content fetcher and parser for Cloudflare Workers.
 *
 * Uses fetch() + Cloudflare HTMLRewriter for fast metadata extraction,
 * then linkedom + @mozilla/readability for body content extraction.
 */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

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

export async function fetchAndParse(url: string): Promise<ParsedContent> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WallabagCF/1.0; +https://wallabag.org)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "text/html";
  const finalUrl = res.url || url;
  const html = await res.text();

  return await parseHtml(html, finalUrl, contentType);
}

/**
 * Parse HTML into structured article content.
 * Pass 1: HTMLRewriter for metadata (title, og:*, lang, canonical).
 * Pass 2: linkedom + Readability for body content, excerpt, byline.
 */
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
