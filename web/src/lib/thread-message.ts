import { PROVIDERS } from "./providers";

const MODEL_SWITCH = /^—\s*moved to\s+(.+?)\s*—$/i;

export function modelSwitch(entry: {kind?: unknown; text?: unknown}): { provider: string; label: string } | undefined {
  if (entry.kind !== "assistant") return undefined;
  const label = (typeof entry.text === "string" ? entry.text.match(MODEL_SWITCH) : undefined)?.[1]?.trim();
  if (!label) return undefined;
  const provider = PROVIDERS.find((candidate) => candidate.label.toLowerCase() === label.toLowerCase());
  return { provider: provider?.id ?? label.toLowerCase(), label };
}

/// Who an entry belongs to. Provider changes are feed state, not a reply, so
/// the next real answer still introduces the agent that wrote it.
export function speaker(entry: {kind?: unknown; text?: unknown}): "you" | "agent" | "system" {
  if (modelSwitch(entry)) return "system";
  return entry.kind === "user" ? "you" : "agent";
}

