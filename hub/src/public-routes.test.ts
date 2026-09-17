import assert from "node:assert/strict";
import test from "node:test";
import { createRouteHandler, type Env } from "./worker.js";

const env = { DB: {}, WEB_APP_URL: "https://app.remy.example", ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) } } as unknown as Env;

test("serves the website and app from their own hostnames", async () => {
  const route = createRouteHandler();
  for (const [url, asset] of [["https://remy.example/", "/"], ["https://remy.example/docs/", "/docs/"], ["https://app.remy.example/", "/app/"], ["https://app.remy.example/workspaces/remy?organization=all", "/app/"], ["https://app.remy.example/assets/index.js", "/app/assets/index.js"]]) {
    const response = await route(new Request(url), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), asset);
  }
  assert.equal((await route(new Request("https://app.remy.example/api/unknown"), env)).status, 404);
});

test("preserves legacy app, sign-in, and invitation links", async () => {
  const route = createRouteHandler();
  for (const [from, to] of [["/?signin=complete", "/?signin=complete"], ["/?invite=sample&next=threads", "/?invite=sample&next=threads"], ["/invite/sample", "/?invite=sample"], ["/app/", "/"]]) {
    const response = await route(new Request(`https://remy.example${from}`), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `https://app.remy.example${to}`);
  }
});

test("forwards registered OAuth callbacks to the host holding the state cookie", async () => {
  const route = createRouteHandler({ betterAuth: async () => ({ handler: async () => new Response("callback processed") }) as never });
  for (const provider of ["google", "github"]) {
    const path = `/api/auth/callback/${provider}?code=sample-code&state=sample-state`;
    const response = await route(new Request(`https://remy.example${path}`), env);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://app.remy.example${path}`);
    const callback = await route(new Request(response.headers.get("location")!), env);
    assert.equal(await callback.text(), "callback processed");
  }
});


test("finishes emailed verification on the app host before creating its session cookie", async () => {
  const route = createRouteHandler({ betterAuth: async () => ({ handler: async () => new Response("verified") }) as never });
  for (const endpoint of ["magic-link/verify", "verify-email"]) {
    const path = `/api/auth/${endpoint}?token=sample-token&callbackURL=https%3A%2F%2Fapp.remy.example%2F`;
    const response = await route(new Request(`https://remy.example${path}`), env);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://app.remy.example${path}`);
    assert.equal(await (await route(new Request(response.headers.get("location")!), env)).text(), "verified");
  }
  const response = await route(new Request("https://remy.example/api/auth/sign-in/magic-link"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
});


test("repository OAuth callback reaches connection validation instead of the asset fallback", async () => {
  let authenticated = false;
  let stateReads = 0;
  const callbackEnv = { ...env, BETTER_AUTH_URL: "https://remy.example", AUTH_SECRET: {get:async()=>"test-secret"}, DB: {
    prepare: () => ({bind:()=>({first:async()=>{stateReads++;return null;}})}),
  }} as unknown as Env;
  const route = createRouteHandler({
    accountService: () => ({authenticate:async()=>authenticated ? {userId:"reader"} : undefined}) as never,
    betterAuth: async () => ({handler:async()=>new Response("sign-in callback")}) as never,
  });
  const path = "/api/auth/callback/github?code=test-code&state=remy-connection.test-state";
  const handoff = await route(new Request(`https://remy.example${path}`), callbackEnv);
  assert.equal(handoff.status, 307);
  const request = new Request(handoff.headers.get("location")!);
  assert.equal((await route(request, callbackEnv)).status, 401);
  assert.equal(stateReads, 0);
  authenticated = true;
  const response = await route(request, callbackEnv);
  assert.equal(response.status, 400);
  assert.match((await response.json() as {error:string}).error, /expired/);
  assert.equal(stateReads, 1);
  assert.equal(await (await route(new Request("https://app.remy.example/api/auth/callback/github?state=signin"), callbackEnv)).text(), "sign-in callback");
});
