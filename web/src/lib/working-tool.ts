/// Keep the latest tool passage active between calls, without reviving an older turn.
export function workingToolGroupId(entries: readonly { id: string; kind: string }[], working: boolean): string | undefined {
  if (!working) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].kind === "user") return undefined;
    if (entries[index].kind !== "tool") continue;
    while (index > 0 && entries[index - 1].kind === "tool") index -= 1;
    return entries[index].id;
  }
  return undefined;
}
