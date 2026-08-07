// HTML sanitizer for user-edited entry content. entry.content is rendered raw
// into the reading view AND the public share view (/share/:uuid), so anything
// stored here is effectively a stored-XSS surface — the POST route can be
// fed crafted input directly, so we sanitize on save.

const BLOCK_BANNED_TAGS = [
  "script", "style", "iframe", "object", "embed", "applet",
  "frame", "frameset", "noscript", "template", "svg", "math",
  "form", "fieldset", "button", "textarea", "select", "option", "optgroup",
  "link", "meta", "base", "title", "head", "portal", "marquee",
  "audio", "video", "source", "track", "canvas", "input",
];

const pairedBannedRe = new RegExp(
  `<(${BLOCK_BANNED_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  "gi",
);
const loneBannedRe = new RegExp(
  `<\\/?(${BLOCK_BANNED_TAGS.join("|")})\\b[^>]*\\/?>`,
  "gi",
);

const commentRe = /<!--[\s\S]*?-->/g;
const cdataRe = /<!\[CDATA\[[\s\S]*?\]\]>/g;

// Raw-text elements: pair to closing tag, or — if unclosed — consume to EOF so
// their body (which is script/style source, not article text) is discarded.
const rawTextBannedRe = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

const eventHandlerRe = /\s+on[a-z][a-z0-9-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const dangerousAttrRe = /\s+(?:srcdoc|formaction|xlink:href|xml:base|http-equiv|ping|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const urlAttrRe = /\s+(?:href|src|poster|background|cite|longdesc|usemap|profile|action|data)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

const styleAttrRe = /\s+style\s*=\s*("[^"]*"|'[^']*')/gi;

const classIdAttrRe = /\s+(?:class|id)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const dataAttrRe = /\s+data-[a-z0-9-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const SAFE_STYLE_PROPS = new Set([
  "text-align", "font-size", "font-weight", "font-style", "font-family",
  "color", "background-color", "text-decoration", "line-height",
  "margin-left", "margin-right", "padding-left", "padding-right",
  "border-left", "border-left-width", "border-left-style", "border-left-color",
  "text-transform", "letter-spacing", "word-spacing",
]);

const SAFE_STYLE_VALUE_RE = /^[a-z0-9 .,#/%'"()\-]+$/i;
const UNSAFE_STYLE_VALUE_RE = /url\s*\(|expression\s*\(|javascript:|vbscript:|@import|behavior|-moz-binding|\\|<|>/i;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalizeUrl(raw: string): string {
  return unquote(raw)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/[\s\x00-\x20\x7f]+/g, "")
    .toLowerCase();
}

function isSafeUrl(raw: string): boolean {
  const v = normalizeUrl(raw);
  if (!v) return true;
  if (
    v.startsWith("javascript:") ||
    v.startsWith("vbscript:") ||
    v.startsWith("data:text/html") ||
    v.startsWith("data:application/") ||
    v.startsWith("data:image/svg") ||
    v.startsWith("file:")
  ) {
    return false;
  }
  return true;
}

function sanitizeStyle(raw: string): string {
  const v = unquote(raw);
  const out: string[] = [];
  for (const decl of v.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (UNSAFE_STYLE_VALUE_RE.test(value)) continue;
    if (!SAFE_STYLE_VALUE_RE.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

/**
 * Sanitize untrusted entry HTML. Approach is regex-based (matching the
 * parser's cleanHtml convention) rather than HTMLRewriter, because
 * HTMLRewriter cannot enumerate or prefix-match attributes (it can't drop
 * all on* handlers generically). Regex is weaker against adversarial nesting,
 * which is why the steps below are layered and the test suite covers OWASP
 * XSS vectors.
 */
export function sanitizeEntryHtml(input: string): string {
  if (!input) return "";
  let html = input;
  html = html.replace(commentRe, "");
  html = html.replace(cdataRe, "");
  html = html.replace(rawTextBannedRe, "");
  html = html.replace(pairedBannedRe, "");
  html = html.replace(loneBannedRe, "");
  html = html.replace(eventHandlerRe, "");
  html = html.replace(dangerousAttrRe, "");
  html = html.replace(urlAttrRe, (match, val) => (isSafeUrl(val) ? match : ""));
  html = html.replace(styleAttrRe, (_m, val) => {
    const s = sanitizeStyle(val);
    return s ? ` style="${s}"` : "";
  });
  html = html.replace(classIdAttrRe, "");
  html = html.replace(dataAttrRe, "");
  html = html.replace(/\u00a0/g, " ");
  html = html.replace(/[ \t]*\n[ \t]*/g, "\n");
  html = html.replace(/\n{3,}/g, "\n\n");
  return html.trim();
}

export function computeReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
