import { HostedStartupError } from "./hosted-startup-error.js";
import type { CloudConnection } from "./cloud-connection.js";
import type { HostedSettings } from "@remy/contract";
export type ComputerRuntime = {
  id: string;
  provider: string;
  providerReference: string;
  startedAt?: number;
  snapshot?: string;
  snapshotBytes?: number;
};
export type ComputerRuntimeCapabilities = {
  checkpoints: boolean;
  persistentFilesystem: boolean;
};
export type ProvisionComputerInput = {
  organizationId: string;
  computerId: string;
  settings: HostedSettings;
  image: string;
  archive: string;
  environment: Record<string, string>;
  allowedDomains: string[];
};
export interface ComputerRuntimeProvider {
  readonly id: string;
  readonly capabilities: ComputerRuntimeCapabilities;
  provision(input: ProvisionComputerInput): Promise<ComputerRuntime>;
  start(
    runtime: ComputerRuntime,
    input: ProvisionComputerInput,
  ): Promise<ComputerRuntime>;
  stop(runtime: ComputerRuntime): Promise<void>;
  checkpoint(runtime: ComputerRuntime): Promise<ComputerRuntime>;
  destroy(runtime: ComputerRuntime): Promise<void>;
  prune?(runtime: ComputerRuntime): Promise<void>;
}

export class HttpRuntimeProvider implements ComputerRuntimeProvider {
  readonly capabilities = { checkpoints: true, persistentFilesystem: true };
  constructor(
    readonly id: string,
    private readonly endpoint: string,
    private readonly credential: () => Promise<string>,
    private readonly send: typeof fetch = (input, init) => fetch(input, init),
    private readonly connection?: () => Promise<CloudConnection>,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1")
      throw new Error("Use HTTPS for hosted computer management.");
  }
  private async call(action: string, input: unknown): Promise<ComputerRuntime> {
    const response = await this.send(
      new URL(`/v1/${this.id}/${action}`, this.endpoint),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.credential()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...(input as object), connection: this.connection ? await this.connection() : undefined }),
        signal: AbortSignal.timeout(180_000),
        redirect: "manual",
      },
    );
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as {code?: string; error?: string};
      if (failure.code === "runtime_operation_failed" && typeof failure.error === "string" && failure.error.length < 300)
        throw new HostedStartupError(failure.error);
      throw new HostedStartupError(`Cloud startup failed during ${action} (HTTP ${response.status}). Retry to continue.`);
    }
    return (await response.json()) as ComputerRuntime;
  }
  provision(input: ProvisionComputerInput) {
    return this.call("provision", input);
  }
  start(runtime: ComputerRuntime, input: ProvisionComputerInput) {
    return this.call("start", { runtime, input });
  }
  async stop(runtime: ComputerRuntime) {
    await this.call("stop", { runtime });
  }
  checkpoint(runtime: ComputerRuntime) {
    return this.call("checkpoint", { runtime });
  }
  async prune(runtime: ComputerRuntime) {
    await this.call("prune", { runtime });
  }
  async destroy(runtime: ComputerRuntime) {
    await this.call("destroy", { runtime });
  }
}
export function computerRuntimeProviders(
  endpoint: string,
  credential: () => Promise<string>,
) {
  return {
    flySprites: new HttpRuntimeProvider("fly-sprites", endpoint, credential),
    modal: new HttpRuntimeProvider("modal", endpoint, credential),
  };
}
