import { isPrivateTarget } from "./fetcher";

export interface EntryForEpub {
  id: number;
  title: string;
  url: string;
  content: string;
  domain_name: string;
  authors: string;
  language: string;
  reading_time: number;
  created_at: string;
  updated_at: string;
  preview_picture: string | null;
}

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
};

function mimeFromUrl(url: string): string {
  try {
    const pathname = new URL(url, "https://example.com").pathname;
    const ext = pathname.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
    // Check for format hints in query params (e.g. ?format=png)
    const fmt = new URL(url, "https://example.com").searchParams.get("format");
    if (fmt && IMAGE_MIME[fmt]) return IMAGE_MIME[fmt];
  } catch { }
  return "image/jpeg";
}

/** Inline images as data: URIs so the EPUB works offline. */
async function inlineImages(html: string, fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<string> {
  const imgRegex = /<img\s[^>]*src="([^"]+)"[^>]*>/gi;
  const matches = [...html.matchAll(imgRegex)];
  if (matches.length === 0) return html;

  const urlSet = [...new Set(matches.map((m) => m[1]))];
  const urlToDataUri = new Map<string, string>();

  const results = await Promise.allSettled(
    urlSet.map(async (url) => {
      try {
        if (url.startsWith("data:")) return;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return;
        // SSRF guard — parity with fetcher.assertSafeFetchUrl. A saved <img src>
        // could otherwise turn EPUB export into an internal proxy whose response
        // body is inlined (and downloaded). DNS-rebinding residual is bounded
        // by CF egress, same as the article fetcher.
        try {
          if (isPrivateTarget(new URL(url).hostname.toLowerCase())) return;
        } catch {
          return;
        }

        const doFetch = fetchFn || globalThis.fetch;
        const resp = await doFetch(url, {
          headers: { "User-Agent": "wallabag-cf-worker/1.0" },
          redirect: "follow",
        } as RequestInit);
        if (!resp.ok) return;

        const mime = resp.headers.get("content-type") || mimeFromUrl(url);
        if (!mime.startsWith("image/")) return;

        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 2 * 1024 * 1024) return;

        const base64 = btoa(
          new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), "")
        );
        urlToDataUri.set(url, `data:${mime};base64,${base64}`);
      } catch {
      }
    })
  );

  let result = html;
  for (const [url, dataUri] of urlToDataUri) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`src="${escaped}"`, "g"), `src="${dataUri}"`);
  }
  return result;
}

/** Async — fetches and inlines images before zipping. */
export async function generateEpub(entry: EntryForEpub, fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<ArrayBuffer> {
  const files: { path: string; data: Uint8Array; compressed: boolean }[] = [];
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const title = entry.title || entry.url || "Untitled";
  const author = entry.authors || entry.domain_name || "Unknown";
  const lang = entry.language || "en";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // mimetype must be first and uncompressed
  files.push({
    path: "mimetype",
    data: new TextEncoder().encode("application/epub+zip"),
    compressed: false,
  });

  files.push({
    path: "META-INF/container.xml",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    compressed: true,
  });

  files.push({
    path: "OEBPS/style.css",
    data: new TextEncoder().encode(`body {
  font-family: serif;
  margin: 1em;
  line-height: 1.6;
}
h1, h2, h3 { margin: 0.5em 0 0.3em; }
p { margin: 0.5em 0; text-align: justify; }
img { max-width: 100%; height: auto; }
a { color: #336; }
blockquote { margin: 0.5em 2em; font-style: italic; }
pre { background: #f5f5f5; padding: 0.5em; overflow-x: auto; }
code { font-family: monospace; }
table { border-collapse: collapse; margin: 0.5em 0; }
td, th { border: 1px solid #ccc; padding: 0.3em 0.5em; }
.meta { color: #666; font-size: 0.9em; margin-bottom: 1em; }
.meta a { color: #666; }`),
    compressed: true,
  });

  const contentWithImages = await inlineImages(entry.content || "", fetchFn);
  const htmlContent = cleanContentForEpub(contentWithImages);
  files.push({
    path: "OEBPS/chapter1.xhtml",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  <p class="meta">By ${escapeXml(author)}${entry.domain_name ? ` — ${escapeXml(entry.domain_name)}` : ""}</p>
  ${entry.preview_picture ? `<img src="${escapeXml(entry.preview_picture)}" alt=""/>` : ""}
  ${htmlContent}
</body>
</html>`),
    compressed: true,
  });

  files.push({
    path: "OEBPS/content.opf",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${uid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${lang}</dc:language>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>`),
    compressed: true,
  });

  files.push({
    path: "OEBPS/toc.ncx",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${escapeXml(title)}</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`),
    compressed: true,
  });

  // toc.xhtml — EPUB 3 navigation document.
  files.push({
    path: "OEBPS/toc.xhtml",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
      <li><a href="chapter1.xhtml">${escapeXml(title)}</a></li>
    </ol>
  </nav>
</body>
</html>`),
    compressed: true,
  });

  return buildZip(files);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanContentForEpub(html: string): string {
  let clean = html;

  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  clean = clean.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  clean = clean.replace(/\s+on\w+="[^"]*"/gi, "");

  // data-* attrs — both quoted and valueless forms (the `?` group).
  clean = clean.replace(/\s+data-[a-z][-a-z0-9]*(?:="[^"]*")?/gi, "");

  // Other XHTML-incompatible attributes.
  clean = clean.replace(/\s+(?:aria-[a-z-]+|role|tabindex|loading|decoding|fetchpriority|crossorigin|integrity)(?:="[^"]*")?/gi, "");

  // XHTML requires self-closing void elements.
  clean = clean.replace(/<br>/gi, "<br/>");
  clean = clean.replace(/<hr>/gi, "<hr/>");
  clean = clean.replace(/<img([^>]*)(?<!\/)>/gi, "<img$1/>");

  // Inline SVGs frequently break XHTML parsing.
  clean = clean.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");

  return clean;
}

// Minimal ZIP builder — Workers has no JSZip, so we emit the bytes by hand:
// ZIP format: [local file headers] + [central directory] + [end of central directory]

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** STORE-only (no deflate) — every EPUB reader we tested accepts these. */
function buildZip(files: { path: string; data: Uint8Array; compressed: boolean }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 + name length + data)
    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);

    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed
    lv.setUint16(6, 0, true); // General purpose bit flag
    lv.setUint16(8, 0, true); // Compression method (0 = stored)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0, true); // Mod date
    lv.setUint32(14, crc, true); // CRC-32
    lv.setUint32(18, size, true); // Compressed size
    lv.setUint32(22, size, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // File name length
    lv.setUint16(28, 0, true); // Extra field length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    localHeaders.push(local);

    // Central directory entry (46 + name length)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);

    cv.setUint32(0, 0x02014b50, true); // Central directory header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0, true); // General purpose bit flag
    cv.setUint16(10, 0, true); // Compression method
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0, true); // Mod date
    cv.setUint32(16, crc, true); // CRC-32
    cv.setUint32(20, size, true); // Compressed size
    cv.setUint32(24, size, true); // Uncompressed size
    cv.setUint16(28, nameBytes.length, true); // File name length
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // File comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, offset, true); // Relative offset of local header
    central.set(nameBytes, 46);

    centralEntries.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralEntries) centralSize += c.length;

  // End of central directory (22 bytes)
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Disk with central dir
  ev.setUint16(8, files.length, true); // Entries on disk
  ev.setUint16(10, files.length, true); // Total entries
  ev.setUint32(12, centralSize, true); // Central dir size
  ev.setUint32(16, centralOffset, true); // Central dir offset
  ev.setUint16(20, 0, true); // Comment length

  const totalSize = offset + centralSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const l of localHeaders) {
    result.set(l, pos);
    pos += l.length;
  }
  for (const c of centralEntries) {
    result.set(c, pos);
    pos += c.length;
  }
  result.set(end, pos);

  return result.buffer;
}
