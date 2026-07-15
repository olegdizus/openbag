export async function enqueueEntryRefetch(queue: any, entryId: number, userId: number) {
  await queue.send({ type: "ENTRY_REFETCH", payload: { entryId, userId } });
}
