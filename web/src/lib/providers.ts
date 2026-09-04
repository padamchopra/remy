/// What a thread can think with: the providers Remy runs, and the models each
/// of them answers to.
///
/// The machine is the authority — `GET /server/providers` answers with the
/// catalogue it validates against, and says which of them is installed there —
/// so this list is the fallback a window paints before the answer arrives.
/// Mirrors `PROVIDERS` in `server/src/providers.ts`.

export interface ProviderModel {
  value: string;
  label: string;
  context?: string;
  resolvedLabel?: string;
  detail?: string;
  efforts?: ProviderEffort[];
  defaultEffort?: string;
}

export interface ProviderEffort {
  value: string;
  label: string;
  detail?: string;
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
  /// Whether the machine that answered has it. Absent means nobody has said.
  available?: boolean;
  /// Whether this machine offers it for new work. Existing threads still keep it.
  enabled?: boolean;
}

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

/// A provider and one of its models. What every picker in Remy reads and writes,
/// because picking a model is picking the thing that runs it.
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

/// How a choice reads on a toolbar: the model's own name, or the provider's when
/// the model is that provider's default.
export function modelLabel(providers: Provider[], choice: ModelChoice): string {
  const provider = providerOf(providers, choice.provider);
  const model = provider?.models.find((entry) => entry.value === (choice.model ?? ""));
  if (!model) return choice.model || (provider?.label ?? "Default");
  if (!model.value) return `${provider?.label ?? "Default"} default`;
  return model.context ? `${model.label} (${model.context})` : model.label;
}

export function resolvedModelLabel(providers: Provider[], choice: ModelChoice): string {
  const provider = providerOf(providers, choice.provider);
  const model = provider?.models.find((entry) => entry.value === (choice.model ?? ""));
  if (model?.value) return model.context ? `${model.label} (${model.context})` : model.label;
  return model?.resolvedLabel ?? modelLabel(providers, choice);
}

export function effortsFor(providers: Provider[], choice: ModelChoice): ProviderEffort[] {
  const provider = providerOf(providers, choice.provider);
  const model = provider?.models.find((entry) => entry.value === (choice.model ?? ""));
  return model?.efforts ?? provider?.efforts ?? [];
}

export function effortLabel(providers: Provider[], choice: ModelChoice): string {
  const efforts = effortsFor(providers, choice);
  if (!choice.effort) {
    const model = providerOf(providers, choice.provider)?.models.find((entry) => entry.value === (choice.model ?? ""));
    const defaultLabel = efforts.find((entry) => entry.value === model?.defaultEffort)?.label;
    return defaultLabel ? `Default - ${defaultLabel}` : "Default effort";
  }
  return efforts.find((entry) => entry.value === choice.effort)?.label ?? choice.effort;
}
