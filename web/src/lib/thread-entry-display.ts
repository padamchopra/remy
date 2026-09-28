type ThreadEntryDisplay = {
  kind?: string;
  text?: unknown;
  output?: unknown;
  arg?: unknown;
  artifacts?: unknown;
  attachments?: unknown;
};

export function threadEntryText(entry: ThreadEntryDisplay): string {
  return String(entry.text ?? entry.output ?? entry.arg ?? "");
}

export function visibleThreadEntries<T extends ThreadEntryDisplay>(entries: T[]): T[] {
  return entries.filter((entry) => {
    if (entry.kind !== "assistant" && entry.kind !== "thinking") return true;
    if (threadEntryText(entry).trim()) return true;
    if (Array.isArray(entry.artifacts) && entry.artifacts.length) return true;
    return Array.isArray(entry.attachments) && entry.attachments.some((attachment) => (
      typeof attachment === "object" && attachment !== null && "remoteId" in attachment && Boolean(attachment.remoteId)
    ));
  });
}
