// Shared data helpers for tags (ADR-0014). The UI tags page and the API
// endpoint both go through these so they share one query path.

import { D1Client } from "../db";
import type { Tag } from "./entries";

/** Tag with usage count (`GET /api/tags` enriched shape). */
export interface TagWithCount extends Tag {
  nbEntries: number;
}

export async function listTags(env: any, userId: number): Promise<TagWithCount[]> {
  const dbc = new D1Client(env.DB);
  return dbc.all<TagWithCount>(
    `SELECT t.id, t.label, t.slug, COUNT(et.entry_id) AS nbEntries
       FROM tags t
       LEFT JOIN entry_tags et ON et.tag_id = t.id
      WHERE t.user_id = ?
      GROUP BY t.id
      ORDER BY t.label`,
    [userId],
  );
}

/** Side-effect: deletes every `entry_tags` link first. */
export async function deleteTag(env: any, userId: number, tagId: number): Promise<void> {
  const dbc = new D1Client(env.DB);
  await dbc.run("DELETE FROM entry_tags WHERE tag_id IN (SELECT id FROM tags WHERE id = ? AND user_id = ?)", [tagId, userId]);
  await dbc.run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tagId, userId]);
}

/** Returns the deleted tag rows (not just a count). */
export async function deleteTagsByLabels(env: any, userId: number, labels: string[]): Promise<Tag[]> {
  const dbc = new D1Client(env.DB);
  const deleted: Tag[] = [];
  for (const label of labels) {
    const tag = await dbc.one<Tag>("SELECT id, label, slug FROM tags WHERE user_id = ? AND label = ?", [userId, label]);
    if (tag) {
      await dbc.run("DELETE FROM entry_tags WHERE tag_id = ?", [tag.id]);
      await dbc.run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tag.id, userId]);
      deleted.push(tag);
    }
  }
  return deleted;
}
