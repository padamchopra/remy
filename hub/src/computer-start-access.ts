export const COMPUTER_START_PROVIDERS = ["claude", "codex", "cursor"] as const;
export type ComputerStartProvider = (typeof COMPUTER_START_PROVIDERS)[number];

export const START_PROVIDER_LABELS: Record<ComputerStartProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

export type SharedStartProvider = {
  id: ComputerStartProvider;
  label: string;
  allowed: boolean;
};

export function isComputerStartProvider(value: string): value is ComputerStartProvider {
  return (COMPUTER_START_PROVIDERS as readonly string[]).includes(value);
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
export function parseStartProviders(value: string | null | undefined): ComputerStartProvider[] | null {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set<ComputerStartProvider>();
    for (const item of parsed) {
      if (typeof item === "string" && isComputerStartProvider(item)) allowed.add(item);
    }
    return COMPUTER_START_PROVIDERS.filter((id) => allowed.has(id));
  } catch {
    return null;
  }
}

export function resolveStartProviders(
  stored: ComputerStartProvider[] | null | undefined,
  advertised: ComputerStartProvider[],
): ComputerStartProvider[] {
  if (stored == null) return advertised;
  const allowed = new Set(stored);
  return advertised.filter((id) => allowed.has(id));
}

export function serializeStartProviders(providers: ComputerStartProvider[]): string {
  return JSON.stringify(providers);
}

export function publicStartProviders(
  advertised: ComputerStartProvider[],
  stored: ComputerStartProvider[] | null,
): SharedStartProvider[] {
  const allowed = new Set(resolveStartProviders(stored, advertised));
  return advertised.map((id) => ({ id, label: START_PROVIDER_LABELS[id], allowed: allowed.has(id) }));
}

export function parseStartProviderInput(
  input: unknown,
  advertised: ComputerStartProvider[],
): ComputerStartProvider[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || !isComputerStartProvider(item))) {
    throw new Error("Choose the providers others may start.");
  }
  const requested = [...new Set(input as ComputerStartProvider[])];
  if (requested.some((id) => !advertised.includes(id))) throw new Error("Choose a provider this computer currently has.");
  return COMPUTER_START_PROVIDERS.filter((id) => requested.includes(id));
}

export const START_PROVIDER_DENIED = "This computer does not allow new threads with that provider.";
