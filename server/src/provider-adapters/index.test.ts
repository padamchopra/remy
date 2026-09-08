import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDERS } from "../providers.js";
import { providerAdapter } from "./index.js";

test("the provider catalogue registers exactly one adapter for every runtime", () => {
  const ids = PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.map((id) => providerAdapter(id).id), ids);
});
