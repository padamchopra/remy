import assert from "node:assert/strict";
import test from "node:test";
import { hostedGatewayError } from "./model-access.js";

const enabled = {
  "access:openrouter": JSON.stringify({
    apiKey: "private-openrouter-key",
    enabled: true,
    models: ["vendor/model"],
  }),
};

test("hosted start accepts an enabled OpenRouter model that is not in the fetched catalogue", () => {
  assert.equal(
    hostedGatewayError("codex", "remy:openrouter:openrouter/auto", enabled),
    undefined,
  );
  assert.equal(
    hostedGatewayError("codex", "remy:openrouter:vendor/model", enabled),
    undefined,
  );
});

test("hosted start still refuses a disabled or unconfigured gateway", () => {
  assert.equal(
    hostedGatewayError("codex", "remy:openrouter:openrouter/auto", {
      "access:openrouter": JSON.stringify({
        apiKey: "private-openrouter-key",
        enabled: false,
        models: ["vendor/model"],
      }),
    }),
    "Choose an enabled provider and model.",
  );
  assert.equal(
    hostedGatewayError("codex", "remy:openrouter:openrouter/auto", {}),
    "Choose an enabled provider and model.",
  );
  assert.equal(
    hostedGatewayError("claude", "remy:openrouter:vendor/model", enabled),
    "Choose an enabled provider and model.",
  );
});
