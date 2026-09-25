import { PROVIDERS, type ModelChoice, type Provider, type ProviderModel } from "./providers";
import type { ModelAccessEntry, ModelAccessResponse } from "@/components/HubModelAccess";

const HOSTED_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  router: "Router.com",
  openrouter: "OpenRouter",
  claude: "Claude Code",
  codex: "ChatGPT",
};

export function claudeCodeConnected(access?: Pick<ModelAccessResponse, "accounts"> | null) {
  return access?.accounts?.claude?.phase === "connected";
}

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
/// start choice.
export function hostedModels(
  entries: ModelAccessEntry[],
  chatgpt = false,
  ensure?: ModelChoice,
  claudeCode = false,
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
  if (claudeCode && !cloudModels.some((entry) => entry.id === "claude")) {
    const runtime = PROVIDERS.find((entry) => entry.id === "claude");
    if (runtime) {
      cloudModels.unshift({
        ...runtime,
        id: "claude",
        label: HOSTED_LABELS.claude,
        efforts: [],
        models: withEnsuredModel(runtime.models, ensure?.provider === "claude" ? ensure.model : undefined),
      });
    }
  }
  if (chatgpt) {
    const runtime = PROVIDERS.find((entry) => entry.id === "codex");
    if (runtime) cloudModels.push({ ...runtime, label: "ChatGPT" });
  }
  return cloudModels;
}

/// The model a new cloud thread should send: the saved default when that
/// account can run it, otherwise the first enabled provider.
export function hostedComposerChoice(
  entries: ModelAccessEntry[],
  chatgpt: boolean,
  inherited: ModelChoice,
  claudeCode = false,
): ModelChoice {
  const catalogue = hostedModels(entries, chatgpt, inherited, claudeCode);
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
