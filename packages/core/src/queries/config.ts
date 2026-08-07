// Shared data helpers for user_config (ADR-0014).

import { D1Client } from "../db";

/**
 * User-config row. The UI settings page and the API endpoint both read/write
 * it through these helpers so they share one query path.
 */
export interface UserConfig {
  theme: string;
  items_per_page: number;
  reading_speed: number;
  language: string;
  action_mark_as_read: number;
  list_mode: number;
  display_thumbnails: number;
}

export async function getConfig(env: any, userId: number): Promise<UserConfig | null> {
  const dbc = new D1Client(env.DB);
  return dbc.one<UserConfig>("SELECT * FROM user_config WHERE user_id = ?", [userId]);
}

/** Coerce to a 1/0 flag, or undefined when the value isn't a recognized truthy/falsy token. */
function asFlag(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return 1;
  if (["0", "false", "off", "no", ""].includes(s)) return 0;
  return undefined;
}

function asPositiveInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export interface ConfigPatch {
  theme?: string;
  items_per_page?: number | string;
  reading_speed?: number | string;
  language?: string;
  action_mark_as_read?: boolean | number | string;
  list_mode?: boolean | number | string;
  display_thumbnails?: boolean | number | string;
}

/** Returns the refreshed row (omitting unchanged fields). */
export async function updateConfig(env: any, userId: number, patch: ConfigPatch): Promise<UserConfig | null> {
  const dbc = new D1Client(env.DB);
  const sets: string[] = [];
  const params: any[] = [];

  if (typeof patch.theme === "string" && patch.theme.trim()) {
    sets.push("theme = ?"); params.push(patch.theme.trim());
  }
  const ipp = asPositiveInt(patch.items_per_page);
  if (ipp !== undefined) { sets.push("items_per_page = ?"); params.push(ipp); }
  const rs = asPositiveInt(patch.reading_speed);
  if (rs !== undefined) { sets.push("reading_speed = ?"); params.push(rs); }
  if (typeof patch.language === "string" && patch.language.trim()) {
    sets.push("language = ?"); params.push(patch.language.trim());
  }
  const amr = asFlag(patch.action_mark_as_read);
  if (amr !== undefined) { sets.push("action_mark_as_read = ?"); params.push(amr); }
  const lm = asFlag(patch.list_mode);
  if (lm !== undefined) { sets.push("list_mode = ?"); params.push(lm); }
  const dt = asFlag(patch.display_thumbnails);
  if (dt !== undefined) { sets.push("display_thumbnails = ?"); params.push(dt); }

  if (sets.length > 0) {
    params.push(userId);
    await dbc.run(`UPDATE user_config SET ${sets.join(", ")} WHERE user_id = ?`, params);
  }
  return getConfig(env, userId);
}
