import assert from "node:assert/strict";
import test from "node:test";
import { hostedGatewayError, hostedStartChoice } from "./model-access.js";

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
  assert.equal(
    hostedGatewayError("openrouter", "openrouter/auto", enabled),
    undefined,
  );
  assert.equal(
    hostedGatewayError(undefined, "remy:openrouter:openrouter/auto", enabled),
    undefined,
  );
});

test("hosted start maps a gateway choice onto Codex before the allowlist", () => {
  assert.deepEqual(hostedStartChoice("openrouter", "openrouter/auto"), {
    provider: "codex",
    model: "remy:openrouter:openrouter/auto",
  });
  assert.deepEqual(hostedStartChoice(undefined, "remy:openrouter:openrouter/auto"), {
    provider: "codex",
    model: "remy:openrouter:openrouter/auto",
  });
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
    hostedGatewayError("openrouter", "openrouter/auto", {}),
    "Choose an enabled provider and model.",
  );
  assert.equal(
    hostedGatewayError("codex", "remy:openrouter:openrouter/auto", {}),
    "Choose an enabled provider and model.",
  );
});
