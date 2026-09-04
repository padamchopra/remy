export type ComputerRuntime = {
  id: string;
  provider: string;
  providerReference: string;
};

export type ComputerRuntimeCapabilities = {
  checkpoints: boolean;
  persistentFilesystem: boolean;
};

export type ProvisionComputerInput = {
  organizationId: string;
  region?: string;
};

export interface ComputerRuntimeProvider {
  readonly id: string;
  readonly capabilities: ComputerRuntimeCapabilities;
  provision(input: ProvisionComputerInput): Promise<ComputerRuntime>;
  start(runtime: ComputerRuntime): Promise<void>;
  stop(runtime: ComputerRuntime): Promise<void>;
  checkpoint?(runtime: ComputerRuntime): Promise<string>;
  destroy(runtime: ComputerRuntime): Promise<void>;
}

const pending = (provider: string): never => {
  throw new Error(`${provider} credentials and provisioning are not configured`);
};

export const computerRuntimeProviders = {
  flySprites: {
    id: "fly-sprites",
    capabilities: { checkpoints: true, persistentFilesystem: true },
    provision: async () => pending("Fly Sprites"),
    start: async () => pending("Fly Sprites"),
    stop: async () => pending("Fly Sprites"),
    checkpoint: async () => pending("Fly Sprites"),
    destroy: async () => pending("Fly Sprites"),
  },
  modal: {
    id: "modal",
    capabilities: { checkpoints: true, persistentFilesystem: true },
    provision: async () => pending("Modal"),
    start: async () => pending("Modal"),
    stop: async () => pending("Modal"),
    checkpoint: async () => pending("Modal"),
    destroy: async () => pending("Modal"),
  },
} as const satisfies Record<string, ComputerRuntimeProvider>;
