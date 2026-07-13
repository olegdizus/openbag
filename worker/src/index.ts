// worker/src/index.ts — top-level barrel for worker internals
// Exposes core utilities (formerly @openbag/core), auth functions (formerly @openbag/auth),
// and parser functions (formerly @openbag/parser) as a single module surface.
// API route composition lives in ./api, Hono export lives in ./api/index.ts.

// --- core ---
export * from "./config";
export * from "./cron";
export * from "./crypto";
export * from "./db";
export * from "./middleware";
export * from "./queue";
export * from "./types";

// --- sanitize (moved from packages/web/src/sanitize.ts) ---
export { sanitizeEntryHtml, computeReadingTime } from "./sanitize";

// --- auth (formerly @openbag/auth) ---
export * from "./auth";

// --- parser (formerly @openbag/parser) ---
export * from "./parser";
