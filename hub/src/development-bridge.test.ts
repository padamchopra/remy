import assert from "node:assert/strict";
import test from "node:test";
import { developmentBridge } from "./development-bridge.js";

const computer = {computerId:"development-computer", organizationId:"personal-owner", ownership:"personal", ownerUserId:"owner"};
const request = (method = "POST", headers: Record<string,string> = {}) => new Request("https://remy.example/api/development/personal-owner/bootstrap", {method, headers});

test("development bridge is disabled unless a computer is explicitly enabled", async () => {
  const response = await developmentBridge(request(), {authenticate:async () => {throw Error("must not authenticate");}, bootstrap:async () => {throw Error("must not read");}});
  assert.equal(response?.status, 404);
});

test("only the signed personal computer's owner supplies the development identity", async () => {
  const users: string[] = [];
  const response = await developmentBridge(request(), {allowedComputerIds:computer.computerId, authenticate:async () => computer, bootstrap:async user => {users.push(user);return {userId:user};}});
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response?.json(), {userId:"owner"});
  assert.deepEqual(users, ["owner"]);
});

test("browser calls and other methods cannot reach the development bridge", async () => {
  for (const incoming of [request("GET"), request("POST", {origin:"https://remy.example"}), request("POST", {"sec-fetch-site":"same-origin"})]) {
    const response = await developmentBridge(incoming, {allowedComputerIds:computer.computerId, authenticate:async () => {throw Error("must not authenticate");}, bootstrap:async () => {throw Error("must not read");}});
    assert.ok([403,405].includes(response!.status));
  }
});

test("missing, unlisted, shared, and mismatched registrations cannot read account data", async () => {
  for (const current of [undefined, {...computer,computerId:"another-computer"}, {...computer,ownership:"organization"}, {...computer,ownerUserId:null}, {...computer,organizationId:"another-account"}]) {
    const response = await developmentBridge(request(), {allowedComputerIds:computer.computerId, authenticate:async () => current, bootstrap:async () => {throw Error("must not read");}});
    assert.equal(response?.status, 403);
  }
});

test("a neighbouring route does not become an unrestricted proxy", async () => {
  assert.equal(await developmentBridge(new Request("https://remy.example/api/development/personal-owner/export", {method:"POST"}), {allowedComputerIds:computer.computerId,authenticate:async () => {throw Error("must not authenticate");},bootstrap:async () => {throw Error("must not read");}}), undefined);
});

test("an approved computer reuses connections without replacing the existing allowlist, and revocation is immediate", async () => {
  let enabled = true;
  const users: string[] = [];
  const bridge = {
    allowedComputerIds: "previously-approved-computer", authenticate: async () => computer,
    approved: async () => enabled, bootstrap: async () => ({}),
    connection: async (_request: Request, userId: string) => { users.push(userId); return Response.json({phase:"connected"}); },
  };
  const incoming = () => new Request("https://remy.example/api/development/personal-owner/chatgpt", {method:"POST",body:JSON.stringify({userId:"injected"})});
  assert.equal((await developmentBridge(incoming(),bridge))?.status,200);
  assert.deepEqual(users,["owner"]);
  enabled = false;
  assert.equal((await developmentBridge(incoming(),bridge))?.status,403);
  assert.deepEqual(users,["owner"]);
  enabled = true;
  assert.equal((await developmentBridge(incoming(),{...bridge,authenticate:async()=>({...computer,ownership:"organization"})}))?.status,403);
  assert.equal((await developmentBridge(new Request(incoming(),{headers:{origin:"https://remy.example"}}),bridge))?.status,403);
});

test("thread access derives the actor from the signed computer and rejects actor injection", async () => {
  const calls: string[][] = [];
  const bridge = {allowedComputerIds:computer.computerId, authenticate:async () => computer, bootstrap:async () => ({}), threadAccess:async (...args: string[]) => {calls.push(args);return {hubEnvironment:{},hubLinear:{kind:"off"}};}};
  const incoming = (body: unknown) => new Request("https://remy.example/api/development/personal-owner/thread-access", {method:"POST",body:JSON.stringify(body)});
  assert.equal((await developmentBridge(incoming({organizationId:"team", workspaceId:"workspace",userId:"another-user"}), bridge))?.status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await developmentBridge(incoming({organizationId:"team", workspaceId:"workspace"}), bridge))?.status, 200);
  assert.deepEqual(calls, [["owner","team","workspace"]]);
});

test("thread access limits request size before resolving credentials", async () => {
  const response = await developmentBridge(new Request("https://remy.example/api/development/personal-owner/thread-access", {method:"POST",body:"x".repeat(4097)}), {
    allowedComputerIds:computer.computerId,authenticate:async () => computer,bootstrap:async () => ({}),threadAccess:async () => {throw Error("must not read");},
  });
  assert.equal(response?.status, 413);
});

test("workspace revocation preserves its denial without exposing connection errors", async () => {
  const response = await developmentBridge(new Request("https://remy.example/api/development/personal-owner/thread-access", {method:"POST",body:JSON.stringify({organizationId:"team",workspaceId:"workspace"})}), {
    allowedComputerIds:computer.computerId,authenticate:async () => computer,bootstrap:async () => ({}),
    threadAccess:async () => {throw Object.assign(new Error("private upstream detail"),{status:403});},
  });
  assert.equal(response?.status,403);
  assert.equal((await response!.text()).includes("private upstream"),false);
});
