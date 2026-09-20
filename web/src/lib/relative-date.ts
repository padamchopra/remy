/// A timestamp as the one- or two-character age a list column can hold, for
/// pull request rows and the repository picker.
export function relativeDate(value: string | null | undefined): string {
  if (!value) return "";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "Now";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
