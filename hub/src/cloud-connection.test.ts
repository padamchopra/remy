import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudConnectionSchema, modelSecrets } from "./cloud-connection.js";
import { HttpRuntimeProvider } from "./computer-runtime.js";
test("cloud credentials cannot become guest environment variables", () => {
  assert.deepEqual(modelSecrets({ ANTHROPIC_API_KEY: "model", "cloud:modal": "private", "cloud:fly-sprites": "private" }), { ANTHROPIC_API_KEY: "model" });
});
test("provider credentials are complete and reject unknown fields", () => {
  assert.equal(cloudConnectionSchema.safeParse({ provider: "modal", tokenId: "id" }).success, false);
  assert.equal(cloudConnectionSchema.safeParse({ provider: "fly-sprites", token: "token", endpoint: "https://other.invalid" }).success, false);
});
test("each operation obtains the account connection separately from guest input", async () => {
  const sent: unknown[] = [];
  const connection = { provider: "fly-sprites" as const, token: "private", enabled: true };
  const adapter = new HttpRuntimeProvider("fly-sprites", "https://control.invalid", async () => "management", async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "computer", provider: "fly-sprites", providerReference: "sprite" });
  }, async () => connection);
  await adapter.destroy({ id: "computer", provider: "fly-sprites", providerReference: "sprite" });
  assert.deepEqual(sent, [{ runtime: { id: "computer", provider: "fly-sprites", providerReference: "sprite" }, connection }]);
});
