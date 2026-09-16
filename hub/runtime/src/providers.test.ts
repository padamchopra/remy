import assert from "node:assert/strict";
import test from "node:test";
import { ExecError } from "@fly/sprites";
import { FlySpritesRuntime } from "./providers.js";
import type { SpritesClient } from "@fly/sprites";
import type { ProvisionComputerInput } from "../../src/computer-runtime.js";

test("Fly provisioning leaves resource allocation to Sprites", async () => {
  let options: unknown;
  const sprite = { name: "sample", updateNetworkPolicy: async () => {}, execFile: async () => ({ exitCode: 0 }) };
  const client = {
    getSprite: async () => { throw { statusCode: 404 }; },
    createSprite: async (_name: string, input: unknown) => { options = input; return sprite; },
    sprite: () => sprite,
  };
  await new FlySpritesRuntime(client as unknown as SpritesClient).provision({
    computerId: "sample", organizationId: "sample", image: "sample", archive: "sample", environment: {}, allowedDomains: [],
    settings: { enabled: true, provider: "fly-sprites", cpu: 16, memoryMiB: 32768, region: "legacy-region", idleMinutes: 12, maxComputers: 5 },
  } satisfies ProvisionComputerInput);
  assert.deepEqual(options, { urlSettings: { auth: "sprite" } });
});

test("a fresh Sprite installs Remy when the entrypoint does not exist", async () => {
  const calls: string[] = [];
  const sprite = { name: "fresh", updateNetworkPolicy: async () => {}, execFile: async (file: string) => {
    calls.push(file);
    if (file === "test") throw new ExecError("Command failed with exit code 1", { exitCode: 1, stdout: "", stderr: "" });
    return {exitCode: 0};
  }};
  const client = {getSprite: async () => sprite, sprite: () => sprite};
  await new FlySpritesRuntime(client as unknown as SpritesClient).provision({
    computerId: "fresh", organizationId: "org", image: "image", archive: "https://example.com/runtime.tar.gz", environment: {}, allowedDomains: [],
    settings: { enabled: true, provider: "fly-sprites", cpu: 1, memoryMiB: 1024, region: "", idleMinutes: 12, maxComputers: 5 },
  });
  assert.deepEqual(calls, ["test", "curl", "tar", "node"]);
});

test("Fly failures expose the operation and status without credential-bearing SDK text", async () => {
  const client = {getSprite: async () => {throw {statusCode: 401, message: "token=secret"};}};
  await assert.rejects(new FlySpritesRuntime(client as unknown as SpritesClient).provision({computerId: "fresh"} as ProvisionComputerInput), error => {
    assert.equal((error as Error).message, "Fly.io failed while finding your Sprite (HTTP 401). Retry to continue.");
    return true;
  });
});
