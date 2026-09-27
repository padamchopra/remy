/// Lines of a diff a message points at, sent with "Send to thread". The
/// computer validates each one fully before its provider sees it
/// (`server/src/chat-references.ts`); the hub only refuses what could never be
/// valid, so a bad request fails here rather than one hop later.
export const MAX_CODE_REFERENCES = 20;
const MAX_REFERENCE_LINES = 200;

export function codeReferencesError(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CODE_REFERENCES) return "Send up to 20 code references.";
  for (const candidate of value) {
    const reference = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : undefined;
    if (
      !reference
      || typeof reference.path !== "string"
      || typeof reference.comment !== "string"
      || !Array.isArray(reference.lines)
      || reference.lines.length === 0
      || reference.lines.length > MAX_REFERENCE_LINES
    ) return "Choose up to 200 lines for each code reference.";
  }
  return undefined;
}

type Line = { kind?: unknown; oldLine?: unknown; newLine?: unknown; text?: unknown };

/// A provider that takes only text, such as Cursor Cloud, reads the same
/// file, range and lines the computer would have put in front of its model.
export function codeReferencesText(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return "";
  return value.slice(0, MAX_CODE_REFERENCES).map((candidate) => {
    const reference = candidate as { path?: unknown; startLine?: unknown; endLine?: unknown; comment?: unknown; lines?: unknown };
    const range = reference.startLine === reference.endLine ? `L${reference.startLine}` : `L${reference.startLine}-${reference.endLine}`;
    const lines = (Array.isArray(reference.lines) ? reference.lines : []).slice(0, MAX_REFERENCE_LINES).map((line: Line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      return `${line.newLine ?? line.oldLine ?? ""}\t${prefix}${String(line.text ?? "")}`;
    });
    return `File: ${String(reference.path)} (${range})\nComment: ${String(reference.comment ?? "")}\n\`\`\`diff\n${lines.join("\n")}\n\`\`\``;
  }).join("\n\n");
}
