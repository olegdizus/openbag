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

// Attribute separators in the HTML tokenizer are whitespace OR `/` — a bare
// `\s+` anchor misses `<img/onerror=…>` (verified stored-XSS bypass, C3).
// `SEP` is the complete set, so `on*`, `srcdoc`, `style`, etc. are stripped
// regardless of which separator precedes them.
const SEP = "[\\s/]";

const eventHandlerRe = new RegExp(`${SEP}+on[a-z][a-z0-9-]*\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

const dangerousAttrRe = new RegExp(`${SEP}+(?:srcdoc|formaction|xlink:href|xml:base|http-equiv|ping|srcset)\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

const urlAttrRe = new RegExp(`${SEP}+(?:href|src|poster|background|cite|longdesc|usemap|profile|action|data)\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

const styleAttrRe = new RegExp(`${SEP}+style\\s*=\\s*("[^"]*"|'[^']*')`, "gi");

const classIdAttrRe = new RegExp(`${SEP}+(?:class|id)\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

const dataAttrRe = new RegExp(`${SEP}+data-[a-z0-9-]+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "gi");

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

/** One pass of tag/attribute stripping. NOT mutation-safe in a single pass —
 *  removing a banned tag can splice neighboring fragments into a new tag
 *  (e.g. `<<script>script>`). Callers loop until stable (see below). */
function stripPass(html: string): string {
  let out = html;
  out = out.replace(commentRe, "");
  out = out.replace(cdataRe, "");
  out = out.replace(rawTextBannedRe, "");
  out = out.replace(pairedBannedRe, "");
  out = out.replace(loneBannedRe, "");
  out = out.replace(eventHandlerRe, "");
  out = out.replace(dangerousAttrRe, "");
  out = out.replace(urlAttrRe, (match, val) => (isSafeUrl(val) ? match : ""));
  out = out.replace(styleAttrRe, (_m, val) => {
    const s = sanitizeStyle(val);
    return s ? ` style="${s}"` : "";
  });
  out = out.replace(classIdAttrRe, "");
  out = out.replace(dataAttrRe, "");
  return out;
}

/**
 * Sanitize untrusted entry HTML. Approach is regex-based (matching the
 * parser's cleanHtml convention) rather than HTMLRewriter, because
 * HTMLRewriter cannot enumerate or prefix-match attributes (it can't drop
 * all on* handlers generically). Regex is weaker against adversarial nesting,
 * which is why the strip pipeline below is **looped to a fixed point** (M2) so
 * a single removal can't expose a tag re-assembled from adjacent fragments,
 * and the test suite covers OWASP XSS vectors. CSP (`script-src 'self'`) is
 * the outer defense-in-depth on the render surfaces.
 */
export function sanitizeEntryHtml(input: string): string {
  if (!input) return "";
  let html = input;
  // M2: loop to a fixed point (cap 5) — kills single-pass mutation bypasses.
  for (let i = 0; i < 5; i++) {
    const next = stripPass(html);
    if (next === html) break;
    html = next;
  }
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
