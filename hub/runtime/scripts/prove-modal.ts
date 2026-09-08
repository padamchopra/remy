if (!process.env.REMY_TEST_IMAGE)
  throw Error("Set REMY_TEST_IMAGE to a built computer image.");
import { ModalRuntime } from "../src/providers.js";
import { ModalClient } from "modal";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const modal = new ModalClient();
const adapter = new ModalRuntime(modal, "remy-hosted-qa");
const id = randomUUID(),
  keys = generateKeyPairSync("ed25519");
const registration = {
  computerId: id,
  organizationId: "qa",
  ownerUserId: null,
  ownership: "hosted",
  name: "Hosted release",
  icon: "cloud",
  platform: "linux",
  daemonVersion: "0.1.0",
  protocol: { minimum: 1, maximum: 1 },
  publicKey: keys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url"),
  capabilities: {
    providers: [],
    workspaces: [],
    worktrees: true,
    terminals: true,
    emulator: false,
  },
  access: { mode: "organization", userIds: [], teamIds: [] },
  registeredAt: Date.now(),
  updatedAt: Date.now(),
  hubUrl: "https://example.test",
};
const input = {
  organizationId: "qa",
  computerId: id,
  settings: {
    enabled: true,
    provider: "modal" as const,
    region: "",
    cpu: 1,
    memoryMiB: 2048,
    idleMinutes: 12,
  },
  image: process.env.REMY_TEST_IMAGE!,
  archive: "",
  environment: {
    MC_CONFIG_DIR: "/data/remy",
    REMY_HOSTED_BOOTSTRAP: JSON.stringify({
      registration,
      privateKey: keys.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64url"),
      workspace: { name: "Release", origin: "example.test/studio/release" },
    }),
  },
  allowedDomains: ["api.anthropic.com", "api.openai.com"],
};
let runtime;
const timings: Record<string, number> = {};
try {
  let at = Date.now();
  runtime = await adapter.provision(input);
  timings.allocationMs = Date.now() - at;
  const run = async (args: string[]) => {
    const sb = await modal.sandboxes.fromId(runtime!.providerReference),
      p = await sb.exec(args);
    const out = await p.stdout.readText();
    if ((await p.wait()) !== 0) throw Error("Proof command failed");
    return out;
  };
  for (let n = 0; n < 50; n++) {
    try {
      const code = await run([
        "node",
        "-e",
        'fetch("http://127.0.0.1:8420/health").then(r=>console.log(r.status))',
      ]);
      if (code.trim() === "401") break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
    if (n === 49) throw Error("Computer never became ready");
  }
  const seed = `const {createChat}=await import('/opt/remy/server/dist/chat.js');const {shareHubThread,hubThreadSnapshot}=await import('/opt/remy/server/dist/hub-threads.js');const chat=createChat({cwd:'/workspace',title:'Checkpoint conversation'});shareHubThread(chat.id,'qa',{id:'ada',label:'Ada'},'manual','open');console.log(JSON.stringify(hubThreadSnapshot(chat.id,'qa')));`;
  const before = JSON.parse(
    await run(["node", "--input-type=module", "-e", seed]),
  );
  await run([
    "node",
    "-e",
    'require("fs").writeFileSync("/workspace/release.txt","Ready for review")',
  ]);
  at = Date.now();
  runtime = await adapter.checkpoint(runtime);
  timings.checkpointMs = Date.now() - at;
  await adapter.stop(runtime);
  at = Date.now();
  runtime = await adapter.start(runtime, input);
  timings.restoreMs = Date.now() - at;
  const after = JSON.parse(
    await run([
      "node",
      "--input-type=module",
      "-e",
      `const {hubThreadSnapshot}=await import('/opt/remy/server/dist/hub-threads.js');console.log(JSON.stringify(hubThreadSnapshot('${before.id}','qa')))`,
    ]),
  );
  if (after.id !== before.id || after.detail.title !== before.detail.title)
    throw Error("Thread did not survive restore");
  if (
    (await run(["cat", "/workspace/release.txt"])).trim() !== "Ready for review"
  )
    throw Error("Workspace did not survive restore");
  writeFileSync(
    process.env.REMY_TEST_REPORT ?? "/tmp/remy-runtime-proof.json",
    JSON.stringify(
      {
        passed: true,
        timings,
        threadPreserved: true,
        workspacePreserved: true,
        modelConversationTested: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: current hosted entrypoint, thread and workspace persist across actual Modal checkpoint/restore",
  );
} finally {
  if (runtime) await adapter.destroy(runtime);
  modal.close();
}
