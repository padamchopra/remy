import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { startProgram } from "./start-program.js";
for (const [state, command, expected] of [["Z", "/opt/remy/server/dist/hosted-entry.js", 1], ["S", "/unrelated.js", 1], ["S", "/opt/remy/server/dist/hosted-entry.js", 0]] as const) {
  test(`startup handles ${state} process running ${command}`, () => {
    let spawned=0;
    runInNewContext(startProgram, {process:{env:{},kill(){}},require:(name:string)=>name==="node:fs"?{
      readFileSync:(path:string)=>path==="/tmp/remy.pid"?"42":path.endsWith("/stat")?`42 (node) ${state} 1 2`:`node\0${command}\0`,writeFileSync(){}
    }:{spawn(){spawned++;return {pid:43,unref(){}};}}});
    assert.equal(spawned,expected);
  });
}
