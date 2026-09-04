export const CONTRACT_VERSION = "0.1.0" as const;

export type ContractVersion = typeof CONTRACT_VERSION;

export type HubEnvironment = "staging" | "production";

export type HubHealth = {
  contractVersion: ContractVersion;
  environment: HubEnvironment;
  release: string;
};

export function parseHubHealth(value: unknown): HubHealth {
  if (
    typeof value !== "object" ||
    value === null ||
    !("contractVersion" in value) ||
    value.contractVersion !== CONTRACT_VERSION ||
    !("environment" in value) ||
    (value.environment !== "staging" && value.environment !== "production") ||
    !("release" in value) ||
    typeof value.release !== "string" ||
    value.release.length === 0
  ) {
    throw new TypeError("The hub health response is incompatible");
  }
  return value as HubHealth;
}

export type ComputerId = string;

export type ComputerRegistration = {
  contractVersion: ContractVersion;
  computerId: ComputerId;
  name: string;
  platform: "darwin" | "linux";
};

export type ComputerAvailability = "available" | "busy" | "offline";

export type ComputerHeartbeat = {
  computerId: ComputerId;
  availability: ComputerAvailability;
  observedAt: string;
};
