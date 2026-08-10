// @openbag/core — shared business logic for @openbag/api and @openbag/web-gui.
//
// Pure TypeScript. No Hono, no HTTP, no fetch surface — just functions of
// `(env, ...args)` returning plain objects (ADR-0018). The Workers runtime
// type `D1Database` is referenced from `db/` via ambient
// `@cloudflare/workers-types`; that is a type-only dependency.
//
// Surface map (sub-imports for namespaces that intentionally do NOT collide
// on the top barrel):
//   @openbag/core                 — queries, auth primitives, session, crypto, sanitizer
//   @openbag/core/wire            — JSON wire shapes for /api/* (Entry, Tag, User, etc.)
//   @openbag/core/db              — D1Client + Db row types (db User has password_hash etc.)

// D1Client only — db/types intentionally not re-exported (collides with wire-types).
export { D1Client } from "./db";

export { toHex, randomHex, tokenHash } from "./crypto";
export { sanitizeEntryHtml, computeReadingTime } from "./sanitize";
export {
  securityHeaders,
  API_CSP,
  UI_CSP,
} from "./security-headers";

export { isRegistrationEnabled } from "./config/feature-flags";

// Session (opaque, sha256-persisted).
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  buildSessionCookie,
  buildExpiredCookie,
  createSession,
  lookupSession,
  revokeSession,
} from "./session";

export { hashPassword, verifyPassword } from "./auth/password";
export {
  createUser,
  findUserByUsername,
  getUserInfo,
  verifyPasswordAgainst,
} from "./auth/users";
export { findClient, createClient, listClients, deleteClient } from "./auth/clients";
export { createAccessToken, createRefreshToken } from "./auth/tokens";
export { passwordGrant, refreshTokenGrant, exchangeAuthCode } from "./auth/grants";
export {
  isThrottled,
  recordLoginFailure,
  clearLoginFailures,
} from "./auth/throttle";

export { fetchAndParse, parseHtml, type ParsedContent } from "./parser/fetcher";
export { generateEpub, type EntryForEpub } from "./parser/epub";

// Query helpers (single source of truth, ADR-0013 → ADR-0018).
// Named exports only — the modules also declare wire-shape interfaces
// (User/Entry/Tag/…) which intentionally duplicate `wire-types.ts`; do NOT
// `export *` them, that would create barrel-level collisions. Consumers that
// need those wire types should `import type { Entry } from "@openbag/core/wire"`.
export {
  hashUrl,
  parseTags,
  upsertTag,
  attachTags,
  getEntryTags,
  enrichEntry,
  getEntries,
  getEntry,
  updateEntry,
  deleteEntry,
  createEntry,
  resetEntryContent,
  fetchContentIfNeeded,
} from "./queries/entries";
export { listTags, deleteTag, deleteTagsByLabels, type TagWithCount } from "./queries/tags";
export { getConfig, updateConfig, type ConfigPatch } from "./queries/config";
export { getFeedToken, rotateFeedToken, revokeFeedToken } from "./queries/feed";
export { createEntriesBulk, type BulkResult } from "./queries/import";
