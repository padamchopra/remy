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

/// Personal model access in an organization, plus exact keys enrolled by
/// members for everyone there.
export interface OwnModelAccessEntry {
  id: "chatgpt" | "anthropic" | "openai" | "router" | "openrouter";
  configured: boolean;
  allowed: boolean;
  keyName: string | null;
  keys: { id: string; name: string; active: boolean; enrolled: boolean; models: string[] }[];
  models: string[];
}
export interface EnrolledModelAccessEntry { connectionId: string; provider: Exclude<OwnModelAccessEntry["id"], "chatgpt">; owner: string; keyId: string; keyName: string; models: string[] }
export interface OwnModelAccessResponse { personal: boolean; providers: OwnModelAccessEntry[]; enrolled: EnrolledModelAccessEntry[] }

/// Picker ids for your own key, so it sits beside the organization's key for
/// the same provider rather than replacing it.
export const OWN_PREFIX = "own:";
export const ENROLLED_PREFIX = "enrolled:";
export const isOwnProvider = (id: string) => id.startsWith(OWN_PREFIX);
export const isEnrolledProvider = (id: string) => id.startsWith(ENROLLED_PREFIX);

/// Your own API keys as providers a cloud thread can start on. ChatGPT is not
/// here: it rides the `chatgpt` flag.
export function ownModels(entries: OwnModelAccessEntry[], ensure?: ModelChoice): Provider[] {
  return entries.filter((entry) => entry.id !== "chatgpt" && entry.configured && entry.allowed).flatMap((entry) => {
    const runtime = runtimeFor(entry.id);
    if (!runtime) return [];
    const keys = entry.keys?.length ? entry.keys : entry.keyName ? [{ id: "legacy", name: entry.keyName, models: entry.models }] : [];
    return keys.map((key) => {
      const id = `${OWN_PREFIX}${entry.id}:${key.id}`;
      return {
      ...runtime,
      id,
      label: `${HOSTED_LABELS[entry.id] ?? runtime.label} · Your ${key.name}`,
      efforts: [],
      models: withEnsuredModel(hostedModelsFor({ id: entry.id, enabled: true, configured: true, models: key.models }), ensure?.provider === id ? ensure.model : undefined),
      };
    });
  });
}

export function enrolledModels(entries: EnrolledModelAccessEntry[], ensure?: ModelChoice): Provider[] {
  return entries.flatMap((entry) => {
    const runtime = runtimeFor(entry.provider);
    if (!runtime) return [];
    const id = `${ENROLLED_PREFIX}${entry.connectionId}`;
    return [{ ...runtime, id, label: `${HOSTED_LABELS[entry.provider] ?? runtime.label} · ${entry.owner} · ${entry.keyName}`, efforts: [], models: withEnsuredModel(hostedModelsFor({ id: entry.provider, enabled: true, configured: true, models: entry.models }), ensure?.provider === id ? ensure.model : undefined) }];
  });
}

/// Everything a cloud thread can start on for you here: the account's model
/// access, then your own keys, each its own tab.
export function cloudCatalogue(entries: ModelAccessEntry[], ensure?: ModelChoice, chatgpt = false, own: OwnModelAccessEntry[] = []): Provider[] {
  return [...hostedModels(entries, ensure, chatgpt), ...ownModels(own, ensure)];
}

/// The model a new cloud thread should send: the saved default when that
/// account can run it, otherwise the first enabled provider.
export function hostedComposerChoice(
  entries: ModelAccessEntry[],
  inherited: ModelChoice,
  chatgpt = false,
  own: OwnModelAccessEntry[] = [],
): ModelChoice {
  const catalogue = cloudCatalogue(entries, inherited, chatgpt, own);
  const match = catalogue.find((entry) => entry.id === inherited.provider);
  if (match?.models.some((model) => model.value === inherited.model)) return inherited;
  if (match) return { provider: match.id, model: match.models[0]?.value ?? "" };
  const first = catalogue[0];
  if (!first) return inherited;
  return { provider: first.id, model: first.models[0]?.value ?? "" };
}

/// Maps a composer or stored gateway choice onto the runtime pair POST /threads
/// accepts. A model that already carries `remy:` keeps that prefix.
export function hostedExecutionChoice(choice: ModelChoice): { provider: string; model: string; modelSource?: "own" | "enrolled"; modelProvider?: string; modelConnection?: string } {
  if (isOwnProvider(choice.provider)) {
    const [provider, ...key] = choice.provider.slice(OWN_PREFIX.length).split(":");
    return { ...hostedExecutionChoice({ ...choice, provider }), modelSource: "own", modelProvider: provider, modelConnection: key.join(":") };
  }
  if (isEnrolledProvider(choice.provider)) {
    const connection = choice.provider.slice(ENROLLED_PREFIX.length);
    const [, provider] = connection.split(":");
    return { ...hostedExecutionChoice({ ...choice, provider }), modelSource: "enrolled", modelProvider: provider, modelConnection: connection };
  }
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
