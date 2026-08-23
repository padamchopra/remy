/// The agents Remy can run a thread on, and what each of them will answer as.
///
/// One catalogue, in one file, because every other place that needs it — the
/// settings a machine holds, an agent's own model, a thread's toolbar, the
/// picker in the window — used to carry its own copy of the same four Claude
/// aliases. Dynamically discovered aliases are remembered alongside this
/// fallback catalogue, so a picker never has to freeze a provider's live list.
///
/// Models are named the way each CLI names them on its own command line, so
/// what Remy stores is what the tool is handed.

export type ProviderId = "claude" | "codex" | "cursor";

export interface ProviderEffort {
  value: string;
  label: string;
  detail?: string;
}

export interface ProviderModel {
  /// What the CLI is handed. Empty means "say nothing", which leaves the choice
  /// to whatever that tool is already configured with.
  value: string;
  label: string;
  /// Short context-window label shown beside the model name.
  context?: string;
  /// What a provider's empty/default choice currently resolves to.
  resolvedLabel?: string;
  /// One short line about when to reach for it, where that is not obvious.
  detail?: string;
  /// Effort levels this exact model accepts. Discovered CLIs replace the
  /// provider fallback when models differ from one another.
  efforts?: ProviderEffort[];
  defaultEffort?: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /// The executable this provider needs on the machine, which is also the key
  /// its status arrives under in `/server/tooling`.
  command: string;
  models: ProviderModel[];
  /// Used when a provider cannot report effort per model itself.
  efforts: ProviderEffort[];
  /// Whether a thread on this provider can stop and ask you to allow a tool
  /// call through its bidirectional integration.
  approvals: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: "claude",
    label: "Claude",
    command: "claude",
    approvals: true,
    // Only the aliases Claude Code accepts on the command line. A free-string
    // model would fail at spawn time, long after the picker said it was fine.
    models: [
      { value: "", label: "Default", resolvedLabel: "Opus 5 (1M)" },
      { value: "opus", label: "Opus 5", context: "1M" },
      { value: "claude-fable-5[1m]", label: "Fable 5", context: "1M" },
      { value: "sonnet", label: "Sonnet 5", context: "200K" },
      { value: "haiku", label: "Haiku 4.5", context: "200K" },
      { value: "claude-opus-4-8", label: "Opus 4.8", context: "1M" },
    ],
    efforts: [
      { value: "low", label: "Low", detail: "Answers faster with less reasoning." },
      { value: "medium", label: "Medium", detail: "Balances speed and reasoning." },
      { value: "high", label: "High", detail: "Reasons deeply before answering." },
      { value: "xhigh", label: "Extra high", detail: "Spends longer on difficult work." },
      { value: "max", label: "Max", detail: "Uses the most supported reasoning." },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    approvals: true,
    models: [
      { value: "", label: "Default", detail: "Whatever Codex is set to." },
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { value: "gpt-5.5", label: "GPT-5.5" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
    efforts: [
      { value: "low", label: "Low", detail: "Answers faster with less reasoning." },
      { value: "medium", label: "Medium", detail: "Balances speed and reasoning." },
      { value: "high", label: "High", detail: "Reasons deeply before answering." },
      { value: "xhigh", label: "Extra high", detail: "Spends longer on difficult work." },
      { value: "max", label: "Max", detail: "Uses the most supported reasoning." },
      { value: "ultra", label: "Ultra", detail: "Uses extended reasoning when the model supports it." },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    command: "agent",
    approvals: true,
    models: [
      { value: "", label: "Default", detail: "Whatever Cursor is set to." },
      { value: "auto", label: "Auto", detail: "Cursor chooses the model." },
    ],
    efforts: [
      { value: "low", label: "Low", detail: "Answers faster with less reasoning." },
      { value: "medium", label: "Medium", detail: "Balances speed and reasoning." },
      { value: "high", label: "High", detail: "Reasons deeply before answering." },
      { value: "xhigh", label: "Extra high", detail: "Spends longer on difficult work." },
      { value: "max", label: "Max", detail: "Uses the most supported reasoning." },
    ],
  },
];

const discoveredModels = new Map<ProviderId, Map<string, ProviderModel>>();

/// Remembers models reported by an installed runtime so a picker choice from a
/// newer CLI remains valid even before Remy's fallback catalogue catches up.
export function rememberProviderModels(id: ProviderId, models: ProviderModel[]): void {
  discoveredModels.set(id, new Map(models.map((model) => [model.value, model])));
}

export const DEFAULT_PROVIDER: ProviderId = "claude";

export function provider(id: unknown): Provider | undefined {
  return PROVIDERS.find((entry) => entry.id === id);
}

export function providerId(value: unknown, fallback: ProviderId = DEFAULT_PROVIDER): ProviderId {
  return provider(value)?.id ?? fallback;
}

/// The model as this provider would accept it, or its default when the value
/// belongs to some other provider. Switching a thread from Claude to Codex
/// therefore lands on Codex's default rather than on `sonnet`, which Codex has
/// never heard of.
export function providerModel(id: unknown, value: unknown): string {
  const resolved = providerId(id);
  const models = provider(resolved)?.models ?? [];
  if (models.some((model) => model.value === value) || discoveredModels.get(resolved)?.has(String(value ?? ""))) {
    return String(value);
  }
  // Cursor model aliases are supplied by the installed CLI and can change
  // independently of Remy. Preserve a previously selected safe alias across a
  // daemon restart; the live catalogue remains what the picker offers.
  if (resolved === "cursor" && typeof value === "string" && /^[A-Za-z0-9._:[\],=-]{1,160}$/.test(value)) {
    return value;
  }
  return "";
}

/// True when this provider knows the model, which is how a caller tells "the
/// pair was already consistent" from "the model was replaced".
export function knowsModel(id: unknown, value: unknown): boolean {
  const resolved = providerId(id);
  return (provider(resolved)?.models ?? []).some((model) => model.value === value)
    || discoveredModels.get(resolved)?.has(String(value ?? "")) === true
    || (resolved === "cursor" && typeof value === "string" && /^[A-Za-z0-9._:[\],=-]{1,160}$/.test(value));
}

function modelEfforts(id: unknown, model: unknown): ProviderEffort[] {
  const resolved = providerId(id);
  const entry = provider(resolved);
  const discovered = discoveredModels.get(resolved)?.get(String(model ?? ""));
  if (discovered?.efforts) return discovered.efforts;
  return entry?.models.find((candidate) => candidate.value === (model ?? ""))?.efforts ?? entry?.efforts ?? [];
}

/// The effort this exact provider/model accepts. Empty means Remy leaves the
/// provider's configured value alone.
export function providerEffort(id: unknown, model: unknown, value: unknown): string {
  if (value === "" || value === undefined || value === null) return "";
  return modelEfforts(id, model).some((effort) => effort.value === value) ? String(value) : "";
}

export function knowsEffort(id: unknown, model: unknown, value: unknown): boolean {
  return value === "" || modelEfforts(id, model).some((effort) => effort.value === value);
}

export function modelLabel(id: unknown, value: unknown): string {
  const models = provider(providerId(id))?.models ?? [];
  return models.find((model) => model.value === (value ?? ""))?.label ?? String(value || "Default");
}

/// What a thread on Codex may touch, from the same permission mode a thread on
/// Claude runs under.
///
/// App-server adds the approval policy around this broad filesystem boundary;
/// see `codexPermissions` for the exact per-turn mapping.
export function codexSandbox(
  permissionMode: string,
): { sandbox: "read-only" | "workspace-write" | "danger-full-access"; approval: "never" } {
  if (permissionMode === "bypassPermissions") return { sandbox: "danger-full-access", approval: "never" };
  if (permissionMode === "acceptEdits" || permissionMode === "auto") {
    return { sandbox: "workspace-write", approval: "never" };
  }
  return { sandbox: "read-only", approval: "never" };
}
