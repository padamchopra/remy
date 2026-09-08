import { ModalClient } from "modal";
import { SpritesClient } from "@fly/sprites";
import type {
  ComputerRuntime,
  ComputerRuntimeProvider,
  ProvisionComputerInput,
} from "../../src/computer-runtime.js";
const ENTRY = "/opt/remy/server/dist/hosted-entry.js";
const startProgram =
  'const{spawn}=require("node:child_process");const fs=require("node:fs");try{process.kill(Number(fs.readFileSync("/tmp/remy.pid","utf8")),0);process.exit(0)}catch{}const p=spawn("node",["/opt/remy/server/dist/hosted-entry.js"],{env:process.env,detached:true,stdio:"ignore"});fs.writeFileSync("/tmp/remy.pid",String(p.pid));p.unref();';
const stopProgram = `(async()=>{const fs=require("node:fs");let pid;try{pid=Number(fs.readFileSync("/tmp/remy.pid","utf8"))}catch{return}if(!Number.isInteger(pid)||pid<2)throw Error("Invalid computer process");try{process.kill(-pid,"SIGTERM")}catch{}for(let n=0;n<100;n++){let status;try{status=fs.readFileSync("/proc/"+pid+"/stat","utf8")}catch{break}if(status.split(") ")[1]?.startsWith("Z"))break;if(n===99)throw Error("Computer did not stop");await new Promise(r=>setTimeout(r,100))}fs.rmSync("/tmp/remy.pid",{force:true})})().catch(()=>process.exit(1));`;

const nameFor = (id: string) => `remy-${id}`;
export class ModalRuntime implements ComputerRuntimeProvider {
  readonly id = "modal";
  readonly capabilities = { checkpoints: true, persistentFilesystem: true };
  constructor(
    private readonly client = new ModalClient(),
    private readonly appName = "remy-hosted-computers",
  ) {}
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
  async provision(input: ProvisionComputerInput): Promise<ComputerRuntime> {
    let sprite;
    try {
      sprite = await this.client.getSprite(nameFor(input.computerId));
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
    sprite ??= await this.client.createSprite(nameFor(input.computerId), {
      config: {
        cpus: input.settings.cpu,
        ramMB: input.settings.memoryMiB,
        region: input.settings.region || undefined,
      },
      urlSettings: { auth: "sprite" },
    });
    await sprite.updateNetworkPolicy({
      rules: [
        ...input.allowedDomains.map((domain) => ({
          domain,
          action: "allow" as const,
        })),
        { domain: "*", action: "deny" },
      ],
    });
    const exists = await sprite.execFile("test", ["-f", ENTRY]);
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
            input.archive,
          ],
        ],
        ["tar", ["-xzf", "/tmp/remy-computer.tar.gz", "-C", "/"]],
      ] as const) {
        const r = await sprite.execFile(file, [...args]);
        if (r.exitCode !== 0)
          throw new Error("Computer image installation failed.");
      }
    }
    return this.start(
      {
        id: input.computerId,
        provider: this.id,
        providerReference: sprite.name,
      },
      input,
    );
  }
  async start(runtime: ComputerRuntime, input: ProvisionComputerInput) {
    const sprite = this.client.sprite(runtime.providerReference);
    await sprite.updateNetworkPolicy({
      rules: [
        ...input.allowedDomains.map((domain) => ({
          domain,
          action: "allow" as const,
        })),
        { domain: "*", action: "deny" },
      ],
    });
    const result = await sprite.execFile("node", ["-e", startProgram], {
      env: input.environment,
    });
    if (result.exitCode !== 0) throw new Error("Computer entrypoint failed.");
    return runtime;
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
export function providers() {
  return {
    modal: new ModalRuntime(),
    "fly-sprites": new FlySpritesRuntime(
      new SpritesClient(process.env.SPRITES_TOKEN ?? ""),
    ),
  };
}
