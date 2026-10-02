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
  assert.deepEqual(calls, ["test", "curl", "tar", "mkdir", "chmod", "setpriv"]);
});

test("Fly drops inherited capabilities without disabling the provider sandbox", async () => {
  let command: unknown;
  const sprite = {updateNetworkPolicy: async () => {}, execFile: async (file: string, args: string[], options: unknown) => {
    command = {file, args: args.slice(0, 5), options};
    return {exitCode: 0};
  }};
  await new FlySpritesRuntime({sprite: () => sprite} as unknown as SpritesClient).start({id: "one", provider: "fly-sprites", providerReference: "one"}, {environment: {SAFE: "value"}, allowedDomains: []} as unknown as ProvisionComputerInput);
  assert.deepEqual(command, {file: "setpriv", args: ["--inh-caps=-all", "--ambient-caps=-all", "--", "node", "-e"], options: {env: {SAFE: "value"}}});
});

test("development cloud starts reload current code and install changed dependencies only once",async()=>{
  const calls: string[] = [];
  let installed = false;
  const sprite = {updateNetworkPolicy:async()=>{},execFile:async(file:string)=>{
    calls.push(file);
    if (file === "cmp") return {exitCode:installed ? 0 : 1};
    if (file === "cp") installed = true;
    return {exitCode:0};
  }};
  const adapter = new FlySpritesRuntime({sprite:()=>sprite} as unknown as SpritesClient);
  const input = {image:"local",archive:"https://local.example/computer.tar.gz",environment:{},allowedDomains:[]} as unknown as ProvisionComputerInput;
  const runtime = {id:"local",provider:"fly-sprites",providerReference:"local"};
  await adapter.start(runtime,input);
  await adapter.start(runtime,input);
  assert.equal(calls.filter(file=>file === "curl").length,2);
  assert.equal(calls.filter(file=>file === "tar").length,2);
  assert.equal(calls.filter(file=>file === "npm").length,2);
  assert.equal(calls.filter(file=>file === "node").length,2);
  assert(calls.indexOf("node") < calls.indexOf("curl"));
});

test("development repairs a missing native module with the bundled Node headers",async()=>{
  const installs: unknown[] = [];
  let boot: string[] = [];
  const sprite = {updateNetworkPolicy:async()=>{},execFile:async(file:string,args:string[],options?:unknown)=>{
    if (file === "/usr/local/bin/node") throw new ExecError("Missing native module",{exitCode:1,stdout:"",stderr:""});
    if (file === "npm") installs.push({args,options});
    if (file === "setpriv") boot=args.slice(0,5);
    return {exitCode:0};
  }};
  await new FlySpritesRuntime({sprite:()=>sprite} as unknown as SpritesClient).start({id:"local",provider:"fly-sprites",providerReference:"local"},{image:"local",archive:"https://local.example/code.tar.gz",environment:{},allowedDomains:[]} as unknown as ProvisionComputerInput);
  assert.deepEqual(installs,["contract","server"].map(folder=>({args:["ci","--prefix",`/opt/remy/${folder}`,"--no-audit","--no-fund","--ignore-scripts=false"],options:{env:{PATH:"/usr/local/bin:/usr/bin:/bin",npm_config_nodedir:"/usr/local"}}})));
  assert.deepEqual(boot,["--inh-caps=-all","--ambient-caps=-all","--","/usr/local/bin/node","-e"]);
});

test("Fly reports the guest boot log without credentials", async () => {
  const sprite = { updateNetworkPolicy: async () => {}, execFile: async () => { throw new ExecError("Command failed with exit code 1", { exitCode: 1, stdout: "token=secret", stderr: "fatal: could not read the repository\n" }); } };
  await assert.rejects(new FlySpritesRuntime({ sprite: () => sprite } as unknown as SpritesClient).start({ id: "one", provider: "fly-sprites", providerReference: "one" }, { environment: {}, allowedDomains: [] } as unknown as ProvisionComputerInput), error => {
    assert.equal((error as Error).message, "Computer entrypoint failed. fatal: could not read the repository");
    return true;
  });
});

test("Fly failures expose the operation and status without credential-bearing SDK text", async () => {
  const client = {getSprite: async () => {throw {statusCode: 401, message: "token=secret"};}};
  await assert.rejects(new FlySpritesRuntime(client as unknown as SpritesClient).provision({computerId: "fresh"} as ProvisionComputerInput), error => {
    assert.equal((error as Error).message, "Fly.io failed while finding your Sprite (HTTP 401). Retry to continue.");
    return true;
  });
});
