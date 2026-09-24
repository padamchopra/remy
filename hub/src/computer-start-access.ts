export const COMPUTER_START_PROVIDERS = ["claude", "codex", "cursor"] as const;
export const CLOUD_GATEWAY_PROVIDERS = ["anthropic", "openai", "router", "openrouter"] as const;
export const START_PROVIDERS = [...CLOUD_GATEWAY_PROVIDERS, ...COMPUTER_START_PROVIDERS] as const;
export type ComputerStartProvider = (typeof COMPUTER_START_PROVIDERS)[number];
export type CloudGatewayProvider = (typeof CLOUD_GATEWAY_PROVIDERS)[number];
export type StartProvider = (typeof START_PROVIDERS)[number];

export const START_PROVIDER_LABELS: Record<StartProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  router: "Router.com",
  openrouter: "OpenRouter",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

export type SharedStartProvider = {
  id: StartProvider;
  label: string;
  allowed: boolean;
};

export function isComputerStartProvider(value: string): value is ComputerStartProvider {
  return (COMPUTER_START_PROVIDERS as readonly string[]).includes(value);
}

export function isStartProvider(value: string): value is StartProvider {
  return (START_PROVIDERS as readonly string[]).includes(value);
}

export function advertisedProviderIds(computer: {
  capabilities?: { providers?: { id: string }[] };
}): ComputerStartProvider[] {
  const seen = new Set<ComputerStartProvider>();
  for (const entry of computer.capabilities?.providers ?? []) {
    if (isComputerStartProvider(entry.id)) seen.add(entry.id);
  }
  return COMPUTER_START_PROVIDERS.filter((id) => seen.has(id));
}

export function providersFromCapabilities(raw: unknown): ComputerStartProvider[] {
  if (raw && typeof raw === "object") return advertisedProviderIds({ capabilities: raw as { providers?: { id: string }[] } });
  if (typeof raw !== "string" || !raw) return [];
  try {
    return advertisedProviderIds({ capabilities: JSON.parse(raw) as { providers?: { id: string }[] } });
  } catch {
    return [];
  }
}

/// `null` means every advertised provider — legacy shares and the share default.
export function parseStartProviders(value: string | null | undefined): StartProvider[] | null {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set<StartProvider>();
    for (const item of parsed) {
      if (typeof item === "string" && isStartProvider(item)) allowed.add(item);
    }
    return START_PROVIDERS.filter((id) => allowed.has(id));
  } catch {
    return null;
  }
}

/// Older cloud shares stored Claude/Codex runtimes for model-access gateways.
function expandLegacyStartProviders(stored: Iterable<string>): Set<string> {
  const allowed = new Set<string>(stored);
  if (allowed.has("codex")) for (const id of ["openai", "router", "openrouter"] as const) allowed.add(id);
  if (allowed.has("claude")) allowed.add("anthropic");
  return allowed;
}

export function resolveStartProviders(
  stored: readonly string[] | null | undefined,
  advertised: readonly StartProvider[],
): StartProvider[] {
  if (stored == null) return [...advertised];
  const allowed = expandLegacyStartProviders(stored);
  return advertised.filter((id) => allowed.has(id));
}

export function serializeStartProviders(providers: StartProvider[]): string {
  return JSON.stringify(providers);
}

export function publicStartProviders(
  advertised: readonly StartProvider[],
  stored: readonly StartProvider[] | null,
): SharedStartProvider[] {
  const allowed = new Set(resolveStartProviders(stored, advertised));
  return advertised.map((id) => ({ id, label: START_PROVIDER_LABELS[id], allowed: allowed.has(id) }));
}

/// Runtime aliases from older clients still grant the matching advertised gateway.
function advertisedFromInput(id: StartProvider, advertised: readonly StartProvider[]): StartProvider[] {
  const aliases = expandLegacyStartProviders([id]);
  return advertised.filter((item) => item === id || aliases.has(item));
}

export function parseStartProviderInput(
  input: unknown,
  advertised: readonly StartProvider[],
): StartProvider[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || !isStartProvider(item))) {
    throw new Error("Choose the providers others may start.");
  }
  const requested = new Set<StartProvider>();
  for (const id of input as StartProvider[]) {
    for (const mapped of advertisedFromInput(id, advertised)) requested.add(mapped);
  }
  if (input.length > 0 && requested.size === 0) throw new Error("Choose a provider this computer currently has.");
  return START_PROVIDERS.filter((id) => requested.has(id));
}

/// Cloud shares advertise the configured gateways, not the Codex/Claude runtime they execute through.
export function advertisedCloudStartProviders(
  access: { id: string; enabled?: boolean; configured?: boolean }[],
): StartProvider[] {
  const seen = new Set<StartProvider>();
  for (const entry of access) {
    if (!entry.enabled || !entry.configured) continue;
    if (isStartProvider(entry.id)) seen.add(entry.id);
  }
  return START_PROVIDERS.filter((id) => seen.has(id));
}

/// Cursor Cloud always runs Cursor; Fly and Modal advertise from model access.
export function advertisedCloudProvidersFor(
  provider: string,
  access: { id: string; enabled?: boolean; configured?: boolean }[],
): StartProvider[] {
  if (provider === "cursor-cloud") return ["cursor"];
  return advertisedCloudStartProviders(access);
}

/// A remapped Codex/Claude start still matches the gateway the person configured.
export function startGrantCandidates(provider?: string, model?: string): StartProvider[] {
  if (!provider) return [];
  const routed = /^remy:(router|openrouter|openai):/.exec(model ?? "");
  const candidates = new Set<StartProvider>();
  const add = (id: string) => {
    if (isStartProvider(id)) candidates.add(id);
  };
  add(provider);
  if (routed) add(routed[1]);
  else if (provider === "codex") for (const id of ["openai", "router", "openrouter"] as const) add(id);
  if (provider === "claude") add("anthropic");
  if (provider === "anthropic") add("claude");
  if (provider === "openai" || provider === "router" || provider === "openrouter") add("codex");
  return START_PROVIDERS.filter((id) => candidates.has(id));
}

/// Owners and org-owned connections keep every advertised provider.
export function canStartWithShareGrant(
  owner: boolean,
  stored: readonly StartProvider[] | null,
  advertised: readonly StartProvider[],
  provider?: string,
  model?: string,
): boolean {
  if (owner) return true;
  const allowed = resolveStartProviders(stored, advertised);
  if (!provider) return allowed.length > 0;
  return startGrantCandidates(provider, model).some((id) => allowed.includes(id));
}

export const START_PROVIDER_DENIED = "This computer does not allow new threads with that provider.";
