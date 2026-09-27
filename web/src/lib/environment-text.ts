/// Reads the lines of a .env file into keys and values: `KEY=value`, with an
/// optional `export`, quotes around the value, and `#` comments skipped.
export function parseEnvironmentText(text: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else value = value.replace(/\s+#.*$/, "");
    const existing = entries.findIndex((entry) => entry.key === match[1]);
    if (existing >= 0) entries.splice(existing, 1);
    entries.push({ key: match[1]!, value });
  }
  return entries;
}
