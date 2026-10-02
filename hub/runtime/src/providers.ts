import { startProgram } from "./start-program.js";
import { HostedStartupError } from "../../src/hosted-startup-error.js";
import { ModalClient } from "modal";
import { ExecError, SpritesClient } from "@fly/sprites";
import type {
  ComputerRuntime,
  ComputerRuntimeProvider,
  ProvisionComputerInput,
} from "../../src/computer-runtime.js";
const ENTRY = "/opt/remy/server/dist/hosted-entry.js";
const stopProgram = `(async()=>{const fs=require("node:fs");let pid;try{pid=Number(fs.readFileSync("/tmp/remy.pid","utf8"))}catch{return}if(!Number.isInteger(pid)||pid<2)throw Error("Invalid computer process");try{process.kill(-pid,"SIGTERM")}catch{}for(let n=0;n<100;n++){let status;try{status=fs.readFileSync("/proc/"+pid+"/stat","utf8")}catch{break}if(status.split(") ")[1]?.startsWith("Z"))break;if(n===99)throw Error("Computer did not stop");await new Promise(r=>setTimeout(r,100))}fs.rmSync("/tmp/remy.pid",{force:true})})().catch(()=>process.exit(1));`;

const nameFor = (id: string) => `remy-${id}`;

function bootText(value: string | Uint8Array | undefined): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

function bootFailure(result: { stdout?: string | Uint8Array; stderr?: string | Uint8Array }) {
  const text = `${bootText(result.stderr)}\n${bootText(result.stdout)}`.replace(/\u001b\[[0-9;]*m/g, "");
  const detail = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/bootstrap|private key|begin |authorization|bearer |token|password/i.test(line)).slice(-6).join(" ").slice(0, 280);
  return detail ? `Computer entrypoint failed. ${detail}` : "Computer entrypoint failed.";
}
export class ModalRuntime implements ComputerRuntimeProvider {
  readonly id = "modal";
  readonly capabilities = { checkpoints: true, persistentFilesystem: true };
  constructor(
    private readonly client = new ModalClient(),
    private readonly appName = "remy-hosted-computers",
  ) {}
  close() { this.client.close(); }
  async provision(input: ProvisionComputerInput) {
    return this.start(
      { id: input.computerId, provider: this.id, providerReference: "" },
      input,
    );
  }
  async start(
    runtime: ComputerRuntime,
    input: ProvisionComputerInput,
  ): Promise<ComputerRuntime> {
    const app = await this.client.apps.fromName(this.appName, {
      createIfMissing: true,
    });
    let sandbox;
    try {
      sandbox = await this.client.sandboxes.experimentalFromName(
        this.appName,
        nameFor(input.computerId),
      );
      if ((await sandbox.poll()) !== null) sandbox = undefined;
    } catch (e) {
      if ((e as Error).name !== "NotFoundError") throw e;
    }
    const reused = !!sandbox;
    if (!sandbox)
      sandbox = await this.client.sandboxes.experimentalCreate(
        app,
        runtime.snapshot
          ? await this.client.images.fromId(runtime.snapshot)
          : input.image.startsWith("im-")
            ? await this.client.images.fromId(input.image)
            : this.client.images.fromRegistry(input.image),
        {
          name: nameFor(input.computerId),
          command: ["sleep", "infinity"],
          env: input.environment,
          cpu: input.settings.cpu,
          memoryMiB: input.settings.memoryMiB,
          regions: input.settings.region ? [input.settings.region] : undefined,
          timeoutMs: 24 * 60 * 60_000,
          outboundDomainAllowlist: input.allowedDomains,
          includeOidcIdentityToken: false,
          tags: {
            remyComputer: input.computerId,
            remyOrganization: input.organizationId,
          },
        },
      );
    const process = await sandbox.exec(["node", "-e", startProgram], {
      env: input.environment,
    });
    if ((await process.wait()) !== 0)
      throw new Error("Computer entrypoint failed.");
    return {
      ...runtime,
      id: input.computerId,
      provider: this.id,
      providerReference: sandbox.sandboxId,
      startedAt: reused ? (runtime.startedAt ?? 0) : Date.now(),
    };
  }
  async stop(runtime: ComputerRuntime) {
    await (
      await this.client.sandboxes.fromId(runtime.providerReference)
    ).terminate();
  }
  async checkpoint(runtime: ComputerRuntime) {
    const sandbox = await this.client.sandboxes.fromId(
      runtime.providerReference,
    );
    const prepare = await sandbox.exec([
      "node",
      "/opt/remy/server/dist/hosted-checkpoint.js",
    ]);
    if ((await prepare.wait()) !== 0)
      throw new Error("Computer could not prepare its checkpoint.");
    const stop = await sandbox.exec(["node", "-e", stopProgram]);
    if ((await stop.wait()) !== 0) throw new Error("Computer did not stop.");
    const size = await sandbox.exec(["du", "-sb", "/data", "/workspace"]);
    const bytes = (await size.stdout.readText())
      .split("\n")
      .reduce((sum, line) => sum + (Number(line.split(/\s/)[0]) || 0), 0);
    if ((await size.wait()) !== 0)
      throw new Error("Storage measurement failed.");
    const snapshot = await sandbox.snapshotFilesystem({ ttlMs: null });
    return { ...runtime, snapshot: snapshot.imageId, snapshotBytes: bytes };
  }
  async prune(runtime: ComputerRuntime) {
    if (runtime.snapshot) await this.client.images.delete(runtime.snapshot);
  }
  async destroy(runtime: ComputerRuntime) {
    let sandbox;
    try {
      sandbox = runtime.providerReference
        ? await this.client.sandboxes.fromId(runtime.providerReference)
        : await this.client.sandboxes.experimentalFromName(
            this.appName,
            nameFor(runtime.id),
          );
    } catch (e) {
      if ((e as Error).name !== "NotFoundError") throw e;
    }
    if (sandbox) await sandbox.terminate();
    if (runtime.snapshot) await this.client.images.delete(runtime.snapshot);
  }
}
export class FlySpritesRuntime implements ComputerRuntimeProvider {
  readonly id = "fly-sprites";
  readonly capabilities = { checkpoints: true, persistentFilesystem: true };
  constructor(private readonly client: SpritesClient) {}
  close() {}
  async provision(input: ProvisionComputerInput): Promise<ComputerRuntime> {
    if (input.image === "local") console.info("Local cloud computer: finding your Sprite.");
    let step = "finding your Sprite";
    try {
    let sprite;
    try {
      sprite = await this.client.getSprite(nameFor(input.computerId));
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
    step = "creating your Sprite";
    sprite ??= await this.client.createSprite(nameFor(input.computerId), {
      urlSettings: { auth: "sprite" },
    });
    step = "configuring your Sprite network";
    await sprite.updateNetworkPolicy({
      rules: [
        ...input.allowedDomains.map((domain) => ({
          domain,
          action: "allow" as const,
        })),
        { domain: "*", action: "deny" },
      ],
    });
    step = "checking the Remy installation";
    const exists = await sprite.execFile("test", ["-f", ENTRY]).catch(error => {
      if (error instanceof ExecError && error.exitCode === 1) return { exitCode: 1 };
      throw error;
    });
    if (exists.exitCode !== 0) {
      for (const [file, args] of [
        [
          "curl",
          [
            "--fail",
            "--location",
            "--proto",
            "=https",
            "--output",
            "/tmp/remy-computer.tar.gz",
            input.image === "local" ? input.baseArchive! : input.archive,
          ],
        ],
        ["tar", ["-xzf", "/tmp/remy-computer.tar.gz", "-C", "/"]],
      ] as const) {
        step = file === "curl" ? "downloading Remy" : "installing Remy";
        const r = await sprite.execFile(file, [...args]);
        if (r.exitCode !== 0)
          throw new Error("Computer image installation failed.");
      }
    }
    step = "starting Remy";
    return await this.start(
      {
        id: input.computerId,
        provider: this.id,
        providerReference: sprite.name,
      },
      input,
    );
    } catch (cause) {
      if (cause instanceof HostedStartupError) throw cause;
      const status = (cause as {statusCode?: number}).statusCode;
      const detail = typeof status === "number" ? ` (HTTP ${status})` : cause instanceof ExecError ? ` (exit ${cause.exitCode})` : "";
      throw new HostedStartupError(`Fly.io failed while ${step}${detail}. Retry to continue.`);
    }
  }
  async start(runtime: ComputerRuntime, input: ProvisionComputerInput) {
    const sprite = this.client.sprite(runtime.providerReference);
    try {
      if (input.image === "local") console.info("Local cloud computer: configuring network access.");
      await sprite.updateNetworkPolicy({
        rules: [
          ...input.allowedDomains.map((domain) => ({
            domain,
            action: "allow" as const,
          })),
          { domain: "*", action: "deny" },
        ],
      });
      if (input.image === "local") {
        console.info("Local cloud computer: loading this checkout's code.");
        for (const [file, args] of [
          ["curl", ["--fail", "--location", "--proto", "=https", "--output", "/tmp/remy-local-computer.tar.gz", input.archive]],
          ["tar", ["-xzf", "/tmp/remy-local-computer.tar.gz", "-C", "/"]],
        ] as const) await sprite.execFile(file, [...args]);
        const installed = await sprite.execFile("cmp", ["-s", "/opt/remy/.development-lock", "/opt/remy/.installed-development-lock"]).catch(error => {
          if (error instanceof ExecError && (error.exitCode === 1 || error.exitCode === 2)) return { exitCode: error.exitCode };
          throw error;
        });
        const native = await sprite.execFile("/usr/local/bin/node", ["-e", "require('/opt/remy/server/node_modules/node-pty')"]).catch(error => {
          if (error instanceof ExecError) return {exitCode:error.exitCode};
          throw error;
        });
        if (installed.exitCode !== 0 || native.exitCode !== 0) {
          console.info("Local cloud computer: installing changed dependencies.");
          for (const folder of ["contract", "server"]) await sprite.execFile("npm", ["ci", "--prefix", `/opt/remy/${folder}`, "--no-audit", "--no-fund", "--ignore-scripts=false"], {env:{PATH:"/usr/local/bin:/usr/bin:/bin",npm_config_nodedir:"/usr/local"}});
          await sprite.execFile("cp", ["/opt/remy/.development-lock", "/opt/remy/.installed-development-lock"]);
        }
      }
      if (input.image === "local") console.info("Local cloud computer: connecting to your local hub.");
      // setpriv below drops the ambient capabilities Sprites grants. Root-owned
      // /data is then not writable, and Remy exits before it can connect.
      await sprite.execFile("mkdir", ["-p", "/data/remy", "/data/codex", "/data/claude", "/workspace", "/tmp/remy-uploads"]);
      await sprite.execFile("chmod", ["0777", "/data", "/data/remy", "/data/codex", "/data/claude", "/workspace", "/tmp/remy-uploads"]);
      // Sprites can give a non-root process ambient capabilities. Bubblewrap
      // rejects those before it can establish Codex's requested sandbox.
      const result = await sprite.execFile("setpriv", ["--inh-caps=-all", "--ambient-caps=-all", "--", input.image === "local" ? "/usr/local/bin/node" : "node", "-e", startProgram], {
        env: input.environment,
      });
      if (result.exitCode !== 0) throw new HostedStartupError(bootFailure(result));
      return runtime;
    } catch (cause) {
      if (cause instanceof HostedStartupError) throw cause;
      if (cause instanceof ExecError) throw new HostedStartupError(bootFailure(cause));
      throw new HostedStartupError(bootFailure({ stderr: cause instanceof Error ? cause.message : "Your cloud computer could not start." }));
    }
  }
  async stop(runtime: ComputerRuntime) {
    const r = await this.client
      .sprite(runtime.providerReference)
      .execFile("node", ["-e", stopProgram]);
    if (r.exitCode !== 0) throw new Error("Computer stop failed.");
  }
  async checkpoint(runtime: ComputerRuntime) {
    await this.stop(runtime);
    const sprite = this.client.sprite(runtime.providerReference);
    const size = await sprite.execFile("du", ["-sb", "/data", "/workspace"]);
    if (size.exitCode !== 0) throw new Error("Storage measurement failed.");
    const comment = `remy-${crypto.randomUUID()}`;
    await (
      await sprite.createCheckpoint(comment)
    ).processAll((msg) => {
      if (msg.type === "error") throw new Error("Checkpoint failed.");
    });
    const snapshot = (await sprite.listCheckpoints()).find(
      (c) => c.comment === comment,
    );
    if (!snapshot) throw new Error("Checkpoint missing.");
    return {
      ...runtime,
      snapshot: snapshot.id,
      snapshotBytes: String(size.stdout)
        .split("\n")
        .reduce((sum, line) => sum + (Number(line.split(/\s/)[0]) || 0), 0),
    };
  }
  async prune(_runtime: ComputerRuntime) {
    /* Sprites manages checkpoint retention. */
  }
  async destroy(runtime: ComputerRuntime) {
    await this.client
      .sprite(runtime.providerReference || nameFor(runtime.id))
      .destroy();
  }
}
export function providers(connection: { provider: string; token?: string; tokenId?: string; tokenSecret?: string }) {
  if (connection.provider === "modal" && connection.tokenId && connection.tokenSecret)
    return new ModalRuntime(new ModalClient({ tokenId: connection.tokenId, tokenSecret: connection.tokenSecret }));
  if (connection.provider === "fly-sprites" && connection.token)
    return new FlySpritesRuntime(new SpritesClient(connection.token));
  throw new Error("Connect your cloud provider in Computers settings.");
}
