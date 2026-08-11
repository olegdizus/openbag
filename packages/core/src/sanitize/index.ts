// HTML sanitizer for user-edited entry content. entry.content is rendered raw
// into the reading view AND the public share view (/share/:uuid), so anything
// stored here is effectively a stored-XSS surface — the POST route can be
// fed crafted input directly, so we sanitize on save.
//
// DOM-based (linkedom) rather than regex. A real HTML tokenizer + tree
// resolves the mutation/nesting bypasses that layered regex passes can still
// miss (removing one tag re-assembling a new one from neighboring fragments),
// and the parser entity-decodes attribute values for us (no manual &#x;
// unrolling). CSP (`script-src 'self'`) remains the outer defense on the
// render surfaces.

import { parseHTML } from "linkedom";

/** Tags removed wholesale (node + subtree): active/foreign/head elements that
 *  can execute script, load active content, or re-enter foreign-content
 *  parsing mode (svg/math switch the tokenizer rules). */
const BANNED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "applet",
  "frame", "frameset", "noscript", "template", "svg", "math",
  "form", "fieldset", "button", "textarea", "select", "option", "optgroup",
  "link", "meta", "base", "title", "head", "portal", "marquee",
  "audio", "video", "source", "track", "canvas", "input",
  "keygen", "isindex", "param",
]);

/** Tags kept (after attribute filtering). Covers article formatting; any tag
 *  that is neither allowed nor banned is unwrapped (children hoisted) so its
 *  text survives without the (possibly exotic) wrapper. */
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo",
  "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hgroup", "hr", "i", "img", "ins", "kbd", "li", "main", "mark",
  "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp",
  "section", "small", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u",
  "ul", "var", "wbr", "picture",
]);

/** URL-bearing attributes — value must pass isSafeUrl or the attr is dropped. */
const URL_ATTRS = new Set([
  "href", "src", "poster", "background", "cite", "longdesc",
  "usemap", "profile", "action", "data",
]);

/** Attributes dropped outright (active-content / exfil sinks). */
const DANGEROUS_ATTRS = new Set([
  "srcdoc", "formaction", "xlink:href", "xml:base", "http-equiv", "ping", "srcset",
]);

const ON_ATTR_RE = /^on[a-z]/i;

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

/** The parser has already entity-decoded the attribute value; strip remaining
 *  control/whitespace chars that browsers ignore inside a scheme
 *  (e.g. `java\nscript:`) before the scheme check. */
function normalizeUrl(raw: string): string {
  return unquote(raw).replace(/[\s\x00-\x20\x7f]+/g, "").toLowerCase();
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

const COMMENT_NODE = 8;
const ELEMENT_NODE = 1;

/** Strip disallowed attributes in place: event handlers, dangerous sinks,
 *  unsafe URLs, unsanitizable style, class/id/data-*. Everything else
 *  (alt, colspan, title, width, height, …) is preserved. */
function filterAttributes(el: any): void {
  for (const attr of Array.from(el.attributes) as any[]) {
    const name = String(attr.name).toLowerCase();
    const value = String(attr.value ?? "");
    if (ON_ATTR_RE.test(name)) {
      el.removeAttribute(attr.name);
    } else if (DANGEROUS_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
    } else if (name === "style") {
      const s = sanitizeStyle(value);
      if (s) el.setAttribute("style", s);
      else el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name)) {
      if (!isSafeUrl(value)) el.removeAttribute(attr.name);
    } else if (name === "class" || name === "id" || name.startsWith("data-")) {
      el.removeAttribute(attr.name);
    }
  }
}

/** Walk `parent`'s direct children: drop comments, recurse into elements. */
function sanitizeChildren(parent: any): void {
  for (const child of Array.from(parent.childNodes) as any[]) {
    if (child.nodeType === COMMENT_NODE) {
      parent.removeChild(child);
    } else if (child.nodeType === ELEMENT_NODE) {
      sanitizeElement(child);
    }
  }
}

/** Depth-first sanitize. Children are processed before this node's fate is
 *  decided, so every descendant is covered even when the node is later removed
 *  (banned) or unwrapped (unknown tag — children hoisted, already clean). */
function sanitizeElement(el: any): void {
  const tag = String(el.tagName).toLowerCase();
  sanitizeChildren(el);
  if (BANNED_TAGS.has(tag)) {
    el.parentNode?.removeChild(el);
    return;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    // unwrap: hoist the (already-sanitized) children, drop the wrapper
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
    return;
  }
  filterAttributes(el);
}

/**
 * Sanitize untrusted entry HTML via a DOM walk: parse to a real tree, drop
 * comments, remove banned elements (subtree), unwrap unknown elements, and
 * filter attributes on what remains. Robust against nesting/mutation tricks
 * because the parser — not a regex — decides element boundaries.
 *
 * linkedom attaches fragment nodes to the document itself (no real
 * <html>/<body> wrapper for fragments), so we gather them under one synthetic
 * element whose `innerHTML` then serializes the cleaned tree cleanly.
 */
export function sanitizeEntryHtml(input: string): string {
  if (!input) return "";
  let doc: any;
  try {
    doc = (parseHTML(input) as any)?.document;
  } catch {
    return "";
  }
  if (!doc) return "";
  const container = doc.createElement("div");
  while (doc.firstChild) container.appendChild(doc.firstChild);
  sanitizeChildren(container);
  let html: string = container.innerHTML;
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
