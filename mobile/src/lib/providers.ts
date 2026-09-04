/// What a thread on a paired Mac can think with: the providers Remy runs, and
/// the models and reasoning efforts each of them answers to.
///
/// The Mac is the authority — `GET /server/providers` answers with the
/// catalogue it validates against, and says which of them is installed there —
/// so this list is only what the phone paints before that answer arrives, or
/// when the Mac is too old to have the route. Mirrors `PROVIDERS` in
/// `server/src/providers.ts`.

export interface ProviderEffort {
  value: string;
  label: string;
  detail?: string;
}

export interface ProviderModel {
  value: string;
  label: string;
  context?: string;
  resolvedLabel?: string;
  detail?: string;
  efforts?: ProviderEffort[];
  defaultEffort?: string;
}

export interface Provider {
  id: string;
  label: string;
  /// The executable it needs on the machine.
  command: string;
  models: ProviderModel[];
  efforts: ProviderEffort[];
  /// Whether a thread on it can stop and ask you to allow a tool call.
  approvals: boolean;
  /// Whether the Mac that answered has it installed. Absent means nobody said.
  available?: boolean;
  /// Whether that Mac offers it for new work. A running thread keeps its own.
  enabled?: boolean;
}

const EFFORTS: ProviderEffort[] = [
  { value: "low", label: "Low", detail: "Answers faster with less reasoning." },
  { value: "medium", label: "Medium", detail: "Balances speed and reasoning." },
  { value: "high", label: "High", detail: "Reasons deeply before answering." },
  { value: "xhigh", label: "Extra high", detail: "Spends longer on difficult work." },
  { value: "max", label: "Max", detail: "Uses the most supported reasoning." },
];

export const PROVIDERS: Provider[] = [
  {
    id: "claude",
    label: "Claude",
    command: "claude",
    approvals: true,
    models: [
      { value: "", label: "Default", resolvedLabel: "Opus 5 (1M)" },
      { value: "opus", label: "Opus 5", context: "1M" },
      { value: "claude-fable-5-1[1m]", label: "Fable 5.1", context: "1M" },
      { value: "sonnet", label: "Sonnet 5", context: "200K" },
      { value: "haiku", label: "Haiku 4.5", context: "200K" },
      { value: "claude-opus-4-8", label: "Opus 4.8", context: "1M" },
    ],
    efforts: EFFORTS,
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
      ...EFFORTS,
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
    efforts: EFFORTS,
  },
];

/// A provider and one of its models, picked together. Every picker on the phone
/// reads and writes this, because picking a model is picking what runs it.
export interface ModelChoice {
  provider: string;
  model: string;
  effort?: string;
}

export function providerOf(providers: Provider[], id?: string): Provider | undefined {
  return providers.find((entry) => entry.id === id) ?? providers[0];
}

export function providerLabel(providers: Provider[], id?: string): string {
  return providerOf(providers, id)?.label ?? id ?? "Claude";
}

/// The providers a new thread may start on here. A Mac that never said keeps
/// every one it knows, so an older Mac offers what it always did.
export function offeredProviders(providers: Provider[]): Provider[] {
  const offered = providers.filter((entry) => entry.enabled !== false && entry.available !== false);
  return offered.length > 0 ? offered : providers;
}

function modelIn(providers: Provider[], choice: ModelChoice): ProviderModel | undefined {
  return providerOf(providers, choice.provider)?.models.find((entry) => entry.value === (choice.model ?? ""));
}

/// How a choice reads on a toolbar: the model's own name, or the provider's
/// when the model is that provider's default.
export function modelLabel(providers: Provider[], choice: ModelChoice): string {
  const provider = providerOf(providers, choice.provider);
  const model = modelIn(providers, choice);
  if (!model) return choice.model || (provider?.label ?? "Default");
  if (!model.value) return `${provider?.label ?? "Default"} default`;
  return model.context ? `${model.label} (${model.context})` : model.label;
}

export function effortsFor(providers: Provider[], choice: ModelChoice): ProviderEffort[] {
  return modelIn(providers, choice)?.efforts ?? providerOf(providers, choice.provider)?.efforts ?? [];
}

export function effortLabel(providers: Provider[], choice: ModelChoice): string {
  const efforts = effortsFor(providers, choice);
  if (!choice.effort) {
    const fallback = efforts.find((entry) => entry.value === modelIn(providers, choice)?.defaultEffort)?.label;
    return fallback ? `Default · ${fallback}` : "Default effort";
  }
  return efforts.find((entry) => entry.value === choice.effort)?.label ?? choice.effort;
}

// Cursor's aliases come from the installed CLI and change independently of
// Remy, so the Mac accepts any safe-looking one. Mirrors `providerModel`.
const CURSOR_ALIAS = /^[A-Za-z0-9._:[\],=-]{1,160}$/;

function knowsModel(provider: Provider, value: string | undefined): boolean {
  const model = value ?? "";
  if (provider.models.some((entry) => entry.value === model)) return true;
  return provider.id === "cursor" && CURSOR_ALIAS.test(model);
}

/// A choice this provider will actually accept.
///
/// Moving to another provider takes the model to that provider's default rather
/// than keeping one it would refuse, and drops an effort level it does not
/// offer — the same rule `providerModel` and `providerEffort` hold the Mac to,
/// so the phone's picker cannot ask for a pair the Mac will silently rewrite.
export function pairChoice(providers: Provider[], asked: ModelChoice): ModelChoice {
  const provider = providerOf(providers, asked.provider);
  if (!provider) return { provider: asked.provider, model: "", effort: "" };
  const model = knowsModel(provider, asked.model) ? asked.model : "";
  const efforts = effortsFor(providers, { provider: provider.id, model });
  const effort = asked.effort && efforts.some((entry) => entry.value === asked.effort) ? asked.effort : "";
  return { provider: provider.id, model, effort };
}
