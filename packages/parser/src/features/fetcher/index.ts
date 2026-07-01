/**
 * Content fetcher and parser for Cloudflare Workers.
 *
 * Uses fetch() + Cloudflare HTMLRewriter for fast metadata extraction,
 * then linkedom + @mozilla/readability for robust article content extraction.
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

/**
 * Fetch a URL and parse its content into a readable article.
 */
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

  return parseHtml(html, finalUrl, contentType);
}

/**
 * Parse HTML into structured article content.
 * Pass 1: HTMLRewriter for metadata (title, og:*, lang, canonical).
 * Pass 2: linkedom + Readability for body content, excerpt, byline.
 */
export function parseHtml(html: string, url: string, contentType: string = "text/html"): ParsedContent {
  const domainName = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();

  // --- Pass 1: metadata via HTMLRewriter (streaming, fast) ---
  let title = "";
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

  metaRewriter.transform(new Response(html));

  // --- Pass 2: content via linkedom + Readability ---
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

  // Fallback to legacy regex extraction if Readability returned nothing useful
  let usedReadability = !!content && contentTextLen >= 100;
  if (!usedReadability) {
    content = extractArticleContent(html);
  }

  // Clean the final HTML for storage.
  // Readability already sanitizes (no scripts/nav); only strip attributes to save space.
  // The legacy fallback needs the full aggressive clean.
  content = usedReadability ? stripAttributes(content) : cleanHtml(content);

  // Title: prefer <title>, then og:title, then Readability
  if (!title.trim() && ogTitle) title = ogTitle;
  const finalTitle = title.trim();

  // Calculate reading time (~200 words per minute) from cleaned content
  const plainText = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const wordCount = (contentTextLen || plainText.split(/\s+/).filter(Boolean).length);
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Excerpt: prefer meta description, then Readability excerpt
  const finalExcerpt = metaDescription || excerpt || plainText.slice(0, 200).trim();

  // Authors: prefer meta[name=author], then Readability byline
  const finalAuthors = authorMeta || byline;

  // Language
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

/**
 * Legacy fallback: extract article content using regex heuristics.
 * Used only when Readability fails to produce usable output.
 */
function extractArticleContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  body = body.replace(/<(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)>/gi, "");
  return body;
}

/**
 * Strip class, style, data-*, and on* attributes from HTML.
 * Applied to Readability output (which is already structurally clean).
 */
function stripAttributes(html: string): string {
  let clean = html;
  clean = clean.replace(/\s+on\w+="[^"]*"/gi, "");
  clean = clean.replace(/\s+class="[^"]*"/gi, "");
  clean = clean.replace(/\s+style="[^"]*"/gi, "");
  clean = clean.replace(/\s+data-[a-z-]+="[^"]*"/gi, "");
  return clean.trim();
}

/**
 * Clean HTML for storage: remove scripts, styles, comments, and inline attributes.
 * Used for the legacy regex fallback path where the HTML has not been curated by Readability.
 */
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
 * Simple language detection based on common words.
 */
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
