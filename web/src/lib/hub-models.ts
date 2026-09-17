import { PROVIDERS, type ModelChoice, type Provider, type ProviderModel } from "./providers";
import type { ModelAccessEntry } from "@/components/HubModelAccess";

const HOSTED_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  router: "Router.com",
  openrouter: "OpenRouter",
};

function runtimeFor(id: string): Provider | undefined {
  return PROVIDERS.find((entry) => entry.id === id)
    ?? PROVIDERS.find((entry) => entry.id === (id === "anthropic" ? "claude" : "codex"));
}

function hostedModelsFor(entry: ModelAccessEntry): ProviderModel[] {
  const runtime = runtimeFor(entry.id);
  if (!runtime) return [];
  if (entry.id === "router" || entry.id === "openrouter") return entry.models.map((value) => ({ value, label: value }));
  if (entry.id === "openai") return runtime.models.filter((model) => model.value);
  return runtime.models;
}

function withEnsuredModel(models: ProviderModel[], model?: string): ProviderModel[] {
  if (!model || models.some((entry) => entry.value === model)) return models;
  return [{ value: model, label: model }, ...models];
}

/// Cloud thread catalogue: enabled providers, plus the current choice so a
/// default is never painted as missing while access is still arriving.
export function hostedModels(entries: ModelAccessEntry[], chatgpt = false, ensure?: ModelChoice): Provider[] {
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
  if (ensure?.provider && HOSTED_LABELS[ensure.provider] && !cloudModels.some((entry) => entry.id === ensure.provider)) {
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
    if (runtime) cloudModels.push({ ...runtime, label: "ChatGPT" });
  }
  return cloudModels;
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
