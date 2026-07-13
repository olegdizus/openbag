import { fetchAndParse } from "../parser";
import { D1Client } from "../index";

const db = (env: any) => new D1Client(env.DB);

/**
 * Fetch and parse content for an entry, then update the DB.
 */
export async function refetchEntry(env: any, entryId: number, userId: number): Promise<void> {
  const entry = await db(env).one<{ id: number; url: string }>(
    "SELECT id, url FROM entries WHERE id = ? AND user_id = ?",
    [entryId, userId]
  );
  if (!entry) {
    console.log(`Entry ${entryId} not found for user ${userId}`);
    return;
  }

  try {
    const parsed = await fetchAndParse(entry.url);

    await db(env).run(
      `UPDATE entries SET
        title = ?,
        content = ?,
        domain_name = ?,
        preview_picture = ?,
        language = ?,
        authors = ?,
        reading_time = ?,
        mimetype = ?,
        is_not_parsed = 0,
        updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
      [
        parsed.title || entry.url,
        parsed.content,
        parsed.domainName,
        parsed.previewPicture || null,
        parsed.language || null,
        parsed.authors || null,
        parsed.readingTime,
        parsed.mimeType,
        entryId,
        userId,
      ]
    );

    console.log(`Successfully parsed entry ${entryId}: ${parsed.title}`);
  } catch (err) {
    console.error(`Failed to parse entry ${entryId}: ${(err as Error).message}`);
    // Mark as parsed anyway so we don't keep retrying forever
    await db(env).run(
      "UPDATE entries SET is_not_parsed = 0, updated_at = datetime('now') WHERE id = ?",
      [entryId]
    );
  }
}

/**
 * Queue consumer handler for entry-refetch messages.
 */
export async function handleEntryRefetch(messages: { body: any }[], env: any): Promise<void> {
  for (const msg of messages) {
    const { entryId, userId } = msg.body.payload || msg.body;
    if (entryId && userId) {
      await refetchEntry(env, entryId, userId);
    }
  }
}
