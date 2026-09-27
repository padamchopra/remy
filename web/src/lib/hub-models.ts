import { KNOWN_MODELS, PROVIDERS, type ModelChoice, type Provider, type ProviderModel } from "./providers";
import type { ModelAccessEntry } from "@/components/HubModelAccess";

const HOSTED_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  router: "Router.com",
  openrouter: "OpenRouter",
};

export function hostedRuntimeProvider(id: string): string {
  if (id === "anthropic") return "claude";
  if (id === "openai" || id === "router" || id === "openrouter") return "codex";
  return id;
}

/// Share grants list gateways (OpenRouter). Older grants listed the Codex runtime.
export function cloudShareAllowsProvider(allowed: ReadonlySet<string> | undefined, providerId: string): boolean {
  if (!allowed) return true;
  return allowed.has(providerId) || allowed.has(hostedRuntimeProvider(providerId));
}

function runtimeFor(id: string): Provider | undefined {
  return PROVIDERS.find((entry) => entry.id === id)
    ?? PROVIDERS.find((entry) => entry.id === hostedRuntimeProvider(id));
}

function catalogueSlug(value: string): string {
  return value.replace(/\[.*\]$/, "").replace(/-/g, ".");
}

/// OpenRouter and Router ids such as `anthropic/claude-opus-5.5` keep the
/// Claude catalogue's name so a search for Opus finds them beside Claude Code.
function hostedGatewayLabel(value: string): string {
  const [vendor, ...rest] = value.split("/");
  const id = rest.length ? rest.join("/") : vendor;
  const runtimeId = vendor === "anthropic" ? "claude" : vendor === "openai" ? "codex" : undefined;
  if (!runtimeId) return value;
  const slug = catalogueSlug(id);
  const provider = PROVIDERS.find((entry) => entry.id === runtimeId);
  for (const model of provider?.models ?? []) {
    if (!model.value) continue;
    const candidate = catalogueSlug(model.value);
    if (slug !== candidate && slug !== catalogueSlug(`claude-${model.value}`)) continue;
    return model.context ? `${model.label} (${model.context})` : model.label;
  }
  return value;
}

function hostedModelsFor(entry: ModelAccessEntry): ProviderModel[] {
  const runtime = runtimeFor(entry.id);
  if (!runtime) return [];
  if (entry.id === "router" || entry.id === "openrouter") {
    return entry.models.map((value) => ({ value, label: hostedGatewayLabel(value) }));
  }
  if (entry.id === "openai") return runtime.models.filter((model) => model.value);
  return runtime.models;
}

function withEnsuredModel(models: ProviderModel[], model?: string): ProviderModel[] {
  if (!model || models.some((entry) => entry.value === model)) return models;
  return [{ value: model, label: hostedGatewayLabel(model) }, ...models];
}

/// Cloud thread catalogue: enabled and configured providers. Keep a saved
/// default selectable only while access is still arriving, or by adding its
/// model onto a provider that is already on. An unconfigured gateway is not a
/// start choice. A workspace whose cloud computer is signed in to ChatGPT adds
/// Codex under that name, which runs on the account rather than an API key.
export function hostedModels(
  entries: ModelAccessEntry[],
  ensure?: ModelChoice,
  chatgpt = false,
): Provider[] {
  const cloudModels: Provider[] = entries.filter((entry) => entry.enabled && entry.configured).flatMap((entry) => {
    const runtime = runtimeFor(entry.id);
    if (!runtime) return [];
    return [{
      ...runtime,
      id: entry.id,
      label: HOSTED_LABELS[entry.id] ?? runtime.label,
      efforts: [],
      models: withEnsuredModel(hostedModelsFor(entry), ensure?.provider === entry.id ? ensure.model : undefined),
    }];
  });
  if (!entries.length && ensure?.provider && HOSTED_LABELS[ensure.provider] && !cloudModels.some((entry) => entry.id === ensure.provider)) {
    const runtime = runtimeFor(ensure.provider);
    if (runtime) {
      cloudModels.unshift({
        ...runtime,
        id: ensure.provider,
        label: HOSTED_LABELS[ensure.provider],
        efforts: [],
        models: withEnsuredModel([], ensure.model),
      });
    }
  }
  if (chatgpt) {
    const runtime = PROVIDERS.find((entry) => entry.id === "codex");
    if (runtime) {
      cloudModels.push({
        ...runtime,
        label: "ChatGPT",
        models: withEnsuredModel(runtime.models, ensure?.provider === "codex" ? ensure.model : undefined),
      });
    }
  }
  return cloudModels;
}

/// The model a new cloud thread should send: the saved default when that
/// account can run it, otherwise the first enabled provider.
export function hostedComposerChoice(
  entries: ModelAccessEntry[],
  inherited: ModelChoice,
  chatgpt = false,
): ModelChoice {
  const catalogue = hostedModels(entries, inherited, chatgpt);
  const match = catalogue.find((entry) => entry.id === inherited.provider);
  if (match?.models.some((model) => model.value === inherited.model)) return inherited;
  if (match) return { provider: match.id, model: match.models[0]?.value ?? "" };
  const first = catalogue[0];
  if (!first) return inherited;
  return { provider: first.id, model: first.models[0]?.value ?? "" };
}

/// Maps a composer or stored gateway choice onto the runtime pair POST /threads
/// accepts. A model that already carries `remy:` keeps that prefix.
export function hostedExecutionChoice(choice: ModelChoice): { provider: string; model: string } {
  if (choice.provider === "anthropic") return { provider: "claude", model: choice.model };
  if (choice.provider === "openai" || choice.provider === "router" || choice.provider === "openrouter") {
    const model = choice.model.startsWith("remy:") ? choice.model : `remy:${choice.provider}:${choice.model}`;
    return { provider: "codex", model };
  }
  if (choice.model.startsWith("remy:")) return { provider: "codex", model: choice.model };
  return { provider: choice.provider, model: choice.model };
}

/// What a computer says it can run, as a provider carries it on the wire.
export interface ComputerProviderModels {
  id: string;
  models: string[];
  modelInfo?: { value: string; label: string; context?: string; resolvedLabel?: string }[];
}

/// A computer's providers with their models named.
///
/// A current daemon sends each model's name as its CLI reports it. An older one
/// sends ids alone, which take their name from Remy's own catalogue; an id that
/// catalogue does not know stays as the id rather than a guessed name.
export function computerModels(entries: ComputerProviderModels[]): Provider[] {
  return entries.flatMap((entry) => {
    const runtime = PROVIDERS.find((provider) => provider.id === entry.id);
    if (!runtime) return [];
    const named = new Map((entry.modelInfo ?? []).map((info) => [info.value, info]));
    const models = entry.models.map((value): ProviderModel => {
      const info = named.get(value);
      const known = runtime.models.find((model) => model.value === value)
        ?? KNOWN_MODELS[runtime.id]?.find((model) => model.value === value);
      if (info) {
        return {
          ...known,
          value,
          label: info.label,
          ...(info.context ? { context: info.context } : {}),
          ...(info.resolvedLabel ? { resolvedLabel: info.resolvedLabel } : {}),
        };
      }
      return known ?? { value, label: value || "Default" };
    });
    return [{ ...runtime, models }];
  });
}

/// What a running thread's model picker offers and shows. A thread on a
/// computer that runs the provider itself picks from that computer's own
/// named models; a cloud thread picks from model access. `options` is what
/// the thread's options action takes for a pick.
export function threadModelPicker(
  detail: { provider?: unknown; model?: unknown; effort?: unknown },
  computer: { capabilities?: { providers?: ComputerProviderModels[] } } | undefined,
  access: ModelAccessEntry[],
) {
  const runtimeProvider = String(detail.provider ?? "codex");
  const runtimeModel = String(detail.model ?? "");
  const gateway = /^remy:(openrouter|router|openai):(.+)$/.exec(runtimeModel);
  const computerCatalogue = !gateway && computer ? computerModels(computer.capabilities?.providers ?? []).filter(p => p.id === runtimeProvider) : [];
  const modelProvider = computerCatalogue.length ? runtimeProvider : gateway?.[1] ?? (runtimeProvider === "claude" ? "anthropic" : runtimeProvider);
  const providers = computerCatalogue.length ? computerCatalogue : hostedModels(access, { provider: modelProvider, model: gateway?.[2] ?? runtimeModel }, modelProvider === "codex");
  return {
    runtimeProvider,
    modelProvider,
    providers,
    value: { provider: modelProvider, model: gateway?.[2] ?? runtimeModel, effort: String(detail.effort ?? "") } as ModelChoice,
    options: (choice: ModelChoice) => ({ model: gateway ? `remy:${gateway[1]}:${choice.model}` : choice.model, effort: choice.effort ?? null }),
  };
}

/// The picker's choice for a stored execution pair: Claude on a cloud
/// computer is Anthropic, and a `remy:` model names its gateway.
export function executionToChoice(provider: string, model: string, cloud: boolean): ModelChoice {
  const gateway = /^remy:(openrouter|router|openai):(.+)$/.exec(model);
  if (gateway) return { provider: gateway[1]!, model: gateway[2]! };
  if (cloud && provider === "claude") return { provider: "anthropic", model };
  return { provider, model };
}
