/**
 * Content fetcher and parser for Cloudflare Workers.
 * 
 * Uses fetch() + Cloudflare HTMLRewriter for metadata extraction,
 * and a simple article content extractor (no jsdom needed).
 */

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
 * Parse HTML into structured article content using Cloudflare HTMLRewriter.
 */
export function parseHtml(html: string, url: string, contentType: string = "text/html"): ParsedContent {
  const domainName = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();

  // Extract metadata using HTMLRewriter
  let title = "";
  let metaDescription = "";
  let ogImage = "";
  let ogTitle = "";
  let authorMeta = "";
  let langAttr = "";
  let canonicalUrl = "";

  // First pass: extract metadata with HTMLRewriter
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

  // Use og:title as fallback for title
  if (!title.trim() && ogTitle) title = ogTitle;

  // Extract the main article content
  const content = extractArticleContent(html);

  // Calculate reading time (~200 words per minute)
  const plainText = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Excerpt: first 200 chars of plain text
  const excerpt = plainText.slice(0, 200).trim();

  // Detect language from html lang attr or content
  const language = langAttr || detectLanguage(plainText);

  return {
    title: title.trim(),
    content,
    domainName,
    excerpt,
    previewPicture: ogImage,
    authors: authorMeta,
    language,
    readingTime,
    mimeType: contentType.split(";")[0].trim(),
    finalUrl: canonicalUrl || url,
  };
}

/**
 * Extract the main article content from HTML.
 * Strategy: find <article>, <main>, or the largest <div> with paragraph text.
 */
function extractArticleContent(html: string): string {
  // Try to find <article> content
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    return cleanHtml(articleMatch[1]);
  }

  // Try <main> content
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    return cleanHtml(mainMatch[1]);
  }

  // Try <div role="main"> or <div class="content|post|article|entry">
  const contentDivMatch = html.match(/<div[^>]*(?:class="[^"]*(?:content|post|article|entry|body)[^"]*"|role="main")[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<script)/i);
  if (contentDivMatch) {
    return cleanHtml(contentDivMatch[1]);
  }

  // Fallback: extract <body> content, strip nav/header/footer
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let body = bodyMatch[1];
    // Remove nav, header, footer, aside, script, style, noscript
    body = body.replace(/<(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside|script|style|noscript|iframe|form|svg)>/gi, "");
    return cleanHtml(body);
  }

  // Last resort: return cleaned full HTML
  return cleanHtml(html);
}

/**
 * Clean HTML: remove scripts, styles, comments, and normalize whitespace.
 */
function cleanHtml(html: string): string {
  let clean = html;
  // Remove script/style blocks
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove HTML comments
  clean = clean.replace(/<!--[\s\S]*?-->/g, "");
  // Remove nav, header, footer, aside
  clean = clean.replace(/<(?:nav|header|footer|aside)[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, "");
  // Remove inline event handlers
  clean = clean.replace(/\s+on\w+="[^"]*"/gi, "");
  // Remove class and style attributes to reduce size
  clean = clean.replace(/\s+class="[^"]*"/gi, "");
  clean = clean.replace(/\s+style="[^"]*"/gi, "");
  // Remove data-* attributes
  clean = clean.replace(/\s+data-[a-z-]+="[^"]*"/gi, "");
  // Normalize whitespace
  clean = clean.replace(/\n{3,}/g, "\n\n");
  clean = clean.trim();
  return clean;
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
