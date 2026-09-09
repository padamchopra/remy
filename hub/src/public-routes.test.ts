import assert from "node:assert/strict";
import test from "node:test";
import { createRouteHandler, type Env } from "./worker.js";

const env = { DB: {}, WEB_APP_URL: "https://app.remy.example", ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) } } as unknown as Env;

test("serves the website and app from their own hostnames", async () => {
  const route = createRouteHandler();
  for (const [url, asset] of [["https://remy.example/", "/"], ["https://remy.example/docs/", "/docs/"], ["https://app.remy.example/", "/app/"], ["https://app.remy.example/assets/index.js", "/app/assets/index.js"]]) {
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
