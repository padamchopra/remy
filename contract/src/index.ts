export const CONTRACT_VERSION = "0.1.0" as const;

export type ContractVersion = typeof CONTRACT_VERSION;

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
