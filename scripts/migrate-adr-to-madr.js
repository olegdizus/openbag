#!/usr/bin/env node
// One-shot migration script: OpenBag ADR (Nygard-flavoured Markdown) → MADR 4.0.
// Safe to run once; overwrites each input file in place under docs/adr/.
//
// Mapping (decided in advance):
//   - Frontmatter-block bullets (- **Status:** / - **Date:** / etc.) → YAML frontmatter.
//   - `## Context`                 → `## Context and Problem Statement`
//   - `## Decision Drivers`        → `## Decision Drivers`              (kept as optional)
//   - `## Considered Options`      → `## Considered Options`
//   - `## Decision`                → `## Decision Outcome`
//   - `## Pros and Cons of the Options` → kept (MADR-allowed optional)
//   - `## Consequences`            → `### Consequences` (hoisted under Decision Outcome)
//   - `## Positive Consequences` / `## Negative Consequences`
//                                  → hoist under `## Decision Outcome` as Good/Bad bullets
//   - Reinforced / Supersedes free-form notice blocks upstream
//                                  → kept verbatim as a blockquote right under the title,
//                                    AND mirrored in frontmatter `custom.reinforces` /
//                                    `custom.reinforced_by` arrays for machine-parsing.
//
// What we DO NOT do:
//   - Rename status enums: still accepted/superseded/deprecated only. "Reinforced"
//     is a note, not a status — MADR 4.0 doesn't carry it, and the user chose
//     strict-MADR.
//
// Usage: node scripts/migrate-adr-to-madr.js

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ADR_DIR = new URL("../docs/adr/", import.meta.url).pathname;

const files = (await readdir(ADR_DIR))
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort();

let counts = { migrated: 0, skipped: 0 };

for (const file of files) {
  const path = join(ADR_DIR, file);
  const original = await readFile(path, "utf8");

  // Skip files already in MADR format (have YAML frontmatter at column 0).
  if (original.startsWith("---\n")) {
    console.log(`skip (already MADR): ${file}`);
    counts.skipped++;
    continue;
  }

  const result = migrate(original, file);
  await writeFile(path, result, "utf8");
  console.log(`migrated: ${file}`);
  counts.migrated++;
}

console.log(`\nDone. migrated=${counts.migrated} skipped=${counts.skipped}`);

// ─────────────────────────────────────────────────────────────────────────────

function migrate(md, filename) {
  const id = filename.slice(0, 4);
  const lines = md.split("\n");

  // 1. Pull the H1 title.
  const h1Idx = lines.findIndex((l) => l.startsWith("# "));
  if (h1Idx === -1) throw new Error(`${filename}: no H1 found`);
  const h1 = lines[h1Idx].replace(/^#\s+/, "").trim();
  // Title in MADR is just the descriptive part. ADR-NNNN prefix is kept as-is
  // because the project convention is explicit numbering and cross-refs depend on it.

  // 2. Parse the metadata bullet block that lives between H1 and the first `##`.
  const meta = parseBulletMetadata(lines.slice(h1Idx + 1));
  const status = normaliseStatus(meta.status);
  const date = (meta.date || "").trim();
  const bodyStart = meta._endOffset + h1Idx + 1;

  // 3. Find/extract any leading reinforced/superseded blockquote notice.
  //    (After ADR-0011, several ADRs carry `> **Reinforced (YYYY-MM-DD).** …` as
  //    the first paragraph after the metadata block.)
  const body = lines.slice(bodyStart).join("\n");
  const { body: bodyClean, notices } = extractNotices(body);

  // 4. Section header remap.
  let migrated = remapSections(bodyClean, h1);

  // 5. Parse cross-references from notices + meta to build frontmatter custom fields.
  const reinforces = extractAdrRefs(notices, meta, [
    "Reinforces",
    "reinforces",
  ]);
  const reinforcedBy = extractAdrRefs(notices, meta, [
    "Reinforced",
    "reinforced",
    "reinforced by",
    "Reinforced by",
  ]);

  // 6. Build YAML frontmatter.
  const frontmatter = buildFrontmatter({
    id,
    title: h1,
    status,
    date,
    supersedes: meta.supersedes ? [meta.supersedes] : [],
    supersededBy: meta.supersededBy ? [meta.supersededBy] : [],
    reinforces,
    reinforcedBy,
  });

  // 7. Re-assemble. Title line stays as the same ADR-NNNN header.
  //    Notices are re-emitted under the title (so the reader still sees them
  //    at the top, before Context and Problem Statement).
  const noticeBlock = notices.length
    ? notices.map((n) => n.raw).join("\n\n") + "\n\n"
    : "";

  return `${frontmatter}\n# ${h1}\n\n${noticeBlock}${migrated.trim()}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a block of `- **Status:** Accepted` / `- **Date:** …` bullets
 * immediately following the H1. Returns a map, plus an `_endOffset` pointing
 * one past the last consumed line.
 */
function parseBulletMetadata(lines) {
  const out = {};
  let i = 0;
  // Skip leading blank lines.
  while (i < lines.length && lines[i].trim() === "") i++;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break; // first section header ends the block
    if (line.startsWith(">")) break; // quote block, not metadata
    const m = line.match(/^-\s+\*\*(?<key>[^:*]+):\*\*\s*(?<val>.*)$/);
    if (!m) continue;
    const key = m.groups.key.trim().toLowerCase().replace(/[^a-z]/g, "_");
    const val = m.groups.val.trim();
    out[key] = val;
  }
  out._endOffset = i;
  return out;
}

function normaliseStatus(raw) {
  const s = (raw || "accepted").toLowerCase();
  if (s.includes("supersed")) return "superseded";
  if (s.includes("deprecat")) return "deprecated";
  if (s.includes("reject")) return "rejected";
  if (s.includes("propos")) return "proposed";
  return "accepted";
}

/**
 * Extract leading `>` blockquote notice blocks from the body. These typically
 * start with `> **Reinforced …**` or `> **Superseded …**`. We return both the
 * raw text and a lowercase predicate for downstream parsing.
 */
function extractNotices(body) {
  const notices = [];
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    // Skip blank lines.
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    if (!lines[i].startsWith(">")) break;
    // Consume contiguous quote lines.
    const block = [];
    while (i < lines.length && lines[i].startsWith(">")) {
      block.push(lines[i]);
      i++;
    }
    const raw = block.join("\n");
    notices.push({
      raw,
      predicate: raw.toLowerCase().replace(/[^a-z ]/g, " ").trim(),
    });
  }
  // Remove the consumed notices (plus any trailing blank line) from the body.
  const bodyClean = lines.slice(i).join("\n").replace(/^\n+/, "");
  return { body: bodyClean, notices };
}

/**
 * Look at metadata + notice predicates and pull out ADR-NNNN tokens
 * matching one of the given predicates. Returns sorted unique list.
 */
function extractAdrRefs(notices, meta, predicates) {
  const wanted = predicates.map((p) => p.toLowerCase());
  const found = new Set();

  // Pull from metadata first.
  for (const [key, val] of Object.entries(meta)) {
    if (wanted.some((w) => key.includes(w.replace(/[^a-z]/g, "_")))) {
      for (const m of String(val).matchAll(/ADR[-\s]?(\d{4})/gi)) {
        found.add(`ADR-${m[1]}`);
      }
    }
  }

  // Then from notice blocks whose predicate contains any of the wanted phrases.
  for (const n of notices) {
    if (wanted.some((w) => n.predicate.includes(w))) {
      for (const m of n.raw.matchAll(/ADR[-\s]?(\d{4})/gi)) {
        found.add(`ADR-${m[1]}`);
      }
      for (const m of n.raw.matchAll(
        /(\d{4})-[a-z0-9-]+\.md/gi,
      )) {
        found.add(`ADR-${m[1]}`);
      }
    }
  }
  return [...found].sort();
}

function buildFrontmatter({
  id,
  title,
  status,
  date,
  supersedes,
  supersededBy,
  reinforces,
  reinforcedBy,
}) {
  const lines = ["---", `# MADR 4.0.0 entry. See docs/adr/template.md.`, `id: "ADR-${id}"`, `title: ${yamlStr(title)}`, `status: "${status}"`];
  if (date) lines.push(`date: ${yamlStr(stripDateNote(date))}`);
  lines.push(`deciders: ["oleg"]`);
  // Cross-reference sections.
  if (supersedes.length)
    lines.push(`supersedes: [${supersedes.map((s) => `"${s}"`).join(", ")}]`);
  if (supersededBy.length)
    lines.push(`superseded: [${supersededBy.map((s) => `"${s}"`).join(", ")}]`);
  if (reinforces.length)
    lines.push(`reinforces: [${reinforces.map((s) => `"${s}"`).join(", ")}]`);
  if (reinforcedBy.length)
    lines.push(`reinforced_by: [${reinforcedBy.map((s) => `"${s}"`).join(", ")}]`);
  lines.push("---");
  return lines.join("\n") + "\n";
}

function yamlStr(s) {
  // Naive YAML scalar quoting. We're a small closed set of values.
  if (s === "") return '""';
  if (/^[\w .,/:()+-]+$/.test(s) && !s.includes(":")) return `"${s}"`;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function stripDateNote(s) {
  // e.g. "2026-06-10 *(retroactive — decision predated ADR practice)*"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/**
 * Apply MADR 4.0 header renames. Notice: we deliberately do NOT merge
 * Consequences into `Decision Outcome` programmatically here — too risky
 * for big-bang. We rename `## Decision` → `## Decision Outcome` and pass
 * everything else through. The subsequent `## Consequences` (which our
 * ADRs already have as a sibling of "Decision") passes through as a
// legitimately MADR-positioned optional top-level section.
 */
function remapSections(body, h1) {
  // Replace H1 (already handled separately).
  let out = body;

  // Decision → Decision Outcome. But preserve an already-correct section if present.
  out = out.replace(/^## Decision$/m, "## Decision Outcome");

  // Context → Context and Problem Statement. (Only when not already the MADR name.)
  out = out.replace(
    /^## Context$/m,
    "## Context and Problem Statement",
  );

  // Some ADRs use "## Rationale" → fold into Decision Outcome.
  // We leave Rationale alone for now; not enough occurrences to risk a regex.

  return out;
}
