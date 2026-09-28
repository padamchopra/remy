import assert from "node:assert/strict";
import test from "node:test";
import { localComputerConfig, localComputerEnvironment } from "./local-development.mjs";

test("development computer cannot inherit a production registration or state path", () => {
  const source = {PATH:"/usr/bin", HOME:"/Users/example", MC_CONFIG_DIR:"/production", MC_TOKEN:"production", REMY_HOSTED_BOOTSTRAP:"production", REMY_LOCAL_STATE:"/ignored"};
  assert.deepEqual(localComputerEnvironment(source, "/tmp/remy-development"), {
    PATH:"/usr/bin", HOME:"/Users/example", MC_CONFIG_DIR:"/tmp/remy-development/computer",
  });
  assert.equal(source.MC_CONFIG_DIR, "/production");
  assert.throws(() => localComputerEnvironment(source, "relative"), /absolute/);
});

test("development computer uses installed provider sign-ins, not the hosting agent session", () => {
  assert.deepEqual(localComputerEnvironment({CLAUDECODE:"1", CLAUDE_AGENT_SDK_TEST:"host", ANTHROPIC_BASE_URL:"https://host.invalid", CODEX_HOME:"/Users/example/.codex"}, "/tmp/remy-development"), {
    CODEX_HOME:"/Users/example/.codex", MC_CONFIG_DIR:"/tmp/remy-development/computer",
  });
  assert.equal(localComputerEnvironment({ANTHROPIC_BASE_URL:"https://configured.invalid"}, "/tmp/remy-development").ANTHROPIC_BASE_URL, "https://configured.invalid");
});

test("restart preserves settings while enforcing the development port and disabling updates", () => {
  const saved = {port:8420, hubMode:false, automaticUpdates:true, token:"local-token", deviceName:"My development computer"};
  assert.deepEqual(localComputerConfig(saved), {...saved, port:8421, hubMode:true, automaticUpdates:false});
  assert.equal(saved.port, 8420);
  assert.deepEqual(localComputerConfig(undefined), {port:8421, hubMode:true, automaticUpdates:false});
});
