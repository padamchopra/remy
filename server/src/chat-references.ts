import type { ChatCodeReference } from "./transcript.js";

const MAX_REFERENCES = 20;
const MAX_REFERENCE_LINES = 200;

export function validateChatCodeReferences(value: unknown): ChatCodeReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) throw new Error("too many code references");
  return value.map((candidate) => {
    const input = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    const id = text(input.id, 200);
    const path = text(input.path, 1_000);
    const comment = text(input.comment, 4_000);
    const startLine = positiveInteger(input.startLine);
    const endLine = positiveInteger(input.endLine);
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!id || !path || !comment || !startLine || !endLine || endLine < startLine) {
      throw new Error("that code reference is incomplete");
    }
    if (rawLines.length === 0 || rawLines.length > MAX_REFERENCE_LINES) {
      throw new Error("that code reference has too many lines");
    }
    return {
      id,
      path,
      startLine,
      endLine,
      comment,
      lines: rawLines.map((candidate) => {
        const line = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
        const kind = line.kind === "add" || line.kind === "del" ? line.kind : "ctx";
        return {
          kind,
          oldLine: nullableLine(line.oldLine),
          newLine: nullableLine(line.newLine),
          text: text(line.text, 10_000),
        };
      }),
    };
  });
}

export function codeReferencePrompt(references: ChatCodeReference[]): string {
  if (references.length === 0) return "";
  const blocks = references.map((reference) => {
    const range = reference.startLine === reference.endLine
      ? `L${reference.startLine}`
      : `L${reference.startLine}-${reference.endLine}`;
    const code = reference.lines.map((line) => {
      const number = line.newLine ?? line.oldLine ?? "";
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      return `${number}\t${prefix}${line.text}`;
    }).join("\n");
    return `File: ${reference.path} (${range})\nComment: ${reference.comment}\n\`\`\`diff\n${code}\n\`\`\``;
  });
  return `<review-context>\n${blocks.join("\n\n")}\n</review-context>`;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nullableLine(value: unknown): number | null {
  return value === null ? null : positiveInteger(value) || null;
}
