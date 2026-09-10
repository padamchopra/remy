import assert from "node:assert/strict";
import test from "node:test";
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
    settings: { enabled: true, provider: "fly-sprites", cpu: 16, memoryMiB: 32768, region: "legacy-region", idleMinutes: 12 },
  } satisfies ProvisionComputerInput);
  assert.deepEqual(options, { urlSettings: { auth: "sprite" } });
});
