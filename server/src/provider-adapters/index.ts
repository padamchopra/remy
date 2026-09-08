import {
  PROVIDERS,
  rememberProviderModels,
  type Provider,
  type ProviderId,
  type ProviderModel,
} from "../providers.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import type { ProviderAdapter, ProviderAnswerOptions } from "./types.js";

export type {
  ProviderAdapter,
  ProviderApprovalDecision,
  ProviderApprovalRequest,
  ProviderEvent,
  ProviderHandlers,
  ProviderImage,
  ProviderPermissionMode,
  ProviderQuestionRequest,
  ProviderRun,
  ProviderSession,
  ProviderSessionOptions,
  ProviderTurn,
} from "./types.js";

const ADAPTERS = new Map<ProviderId, ProviderAdapter>([
  [claudeAdapter.id, claudeAdapter],
  [codexAdapter.id, codexAdapter],
  [cursorAdapter.id, cursorAdapter],
]);

let discovered: Promise<Provider[]> | undefined;

export function providerAdapter(id: ProviderId): ProviderAdapter {
  const adapter = ADAPTERS.get(id);
  if (!adapter) throw new Error(`No adapter is registered for ${id}.`);
  return adapter;
}

export function setProviderAdapterForTest(adapter: ProviderAdapter): () => void {
  const previous = ADAPTERS.get(adapter.id);
  ADAPTERS.set(adapter.id, adapter);
  return () => {
    if (previous) ADAPTERS.set(adapter.id, previous);
    else ADAPTERS.delete(adapter.id);
  };
}

export async function providerAnswer(id: ProviderId, options: ProviderAnswerOptions): Promise<string | undefined> {
  return providerAdapter(id).answer(options);
}

export function discoveredProviders(): Promise<Provider[]> {
  discovered ??= Promise.all(PROVIDERS.map(async (provider) => {
    const result = await providerAdapter(provider.id).discoverModels().catch(() => [] as ProviderModel[]);
    const seen = new Set(result.map((model) => model.value));
    const models = [...result, ...provider.models.filter((model) => !seen.has(model.value))];
    rememberProviderModels(provider.id, models);
    return { ...provider, models };
  }));
  return discovered;
}
