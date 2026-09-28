import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import * as path from "node:path";
import { startProgram } from "./start-program.js";
test("startup fails before advertising a computer without the Codex helper", () => {
  assert.throws(() => runInNewContext(startProgram, {
    process: {env: {}},
    require: (name: string) => name === "node:path" ? path : name === "node:fs" ? {readdirSync: () => []} : {spawn() {assert.fail("must not start Remy");}},
  }), /Codex command helper is missing/);
});
for (const [state, command, expected] of [["Z", "/opt/remy/server/dist/hosted-entry.js", 1], ["S", "/unrelated.js", 1], ["S", "/opt/remy/server/dist/hosted-entry.js", 0]] as const) {
  test(`startup handles ${state} process running ${command}`, () => {
    let spawned=0;
    const environment = {PATH:"/preinstalled/bin:/usr/bin:/bin"};
    runInNewContext(startProgram, {process:{env:environment,kill(){}},require:(name:string)=>name==="node:path"?path:name==="node:fs"?{
      readdirSync:()=>["node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host"],
      readFileSync:(path:string)=>path==="/tmp/remy.pid"?"42":path.endsWith("/stat")?`42 (node) ${state} 1 2`:`node\0${command}\0`,writeFileSync(){}
    }:{spawn(){spawned++;return {pid:43,unref(){}};}}});
    assert.equal(spawned,expected);
    assert.equal(environment.PATH.split(":")[0], "/usr/local/bin");
    assert.match(environment.PATH.split(":")[1], /vendor\/x86_64-unknown-linux-musl\/bin$/);
  });
}
