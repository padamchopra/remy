import type { ConvEntry } from "~/state/types";

const optimisticUsers = new Map<string, { chatId: string; serverId: string; text: string }>();

export function registerOptimisticUser(chatId: string, serverId: string, entry: ConvEntry): void {
  optimisticUsers.set(entry.id, { chatId, serverId, text: entry.text ?? "" });
}

export function clearOptimisticUser(entryId: string): void {
  optimisticUsers.delete(entryId);
}

export function uniqueEntries(entries: ConvEntry[]): ConvEntry[] {
  return mergeEntryUpdates([], entries, "", "");
}

export function mergeEntryUpdates(
  current: ConvEntry[],
  incoming: ConvEntry[],
  chatId: string,
  serverId: string,
): ConvEntry[] {
  const next: ConvEntry[] = [];
  const indexes = new Map<string, number>();
  const put = (entry: ConvEntry, reconcileOptimistic: boolean) => {
    let index = indexes.get(entry.id);
    if (index === undefined && reconcileOptimistic && entry.kind === "user") {
      index = next.findIndex((candidate) => {
        const optimistic = optimisticUsers.get(candidate.id);
        return Boolean(
          optimistic
          && optimistic.chatId === chatId
          && optimistic.serverId === serverId
          && optimistic.text === (entry.text ?? ""),
        );
      });
    }
    if (index === undefined || index < 0) {
      indexes.set(entry.id, next.length);
      next.push(entry);
      return;
    }
    const replaced = next[index];
    if (replaced) indexes.delete(replaced.id);
    indexes.set(entry.id, index);
    next[index] = entry;
  };
  for (const entry of current) put(entry, false);
  for (const entry of incoming) put(entry, true);
  return next;
}
