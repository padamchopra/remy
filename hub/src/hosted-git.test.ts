import test from "node:test";
import assert from "node:assert/strict";
import {
  GitCapabilities,
  githubRepository,
  validatePush,
  proxyGit,
} from "./hosted-git.js";
const packet = (s: string) =>
  `${(Buffer.byteLength(s) + 4).toString(16).padStart(4, "0")}${s}`;
const command = (branch: string) =>
  `${"a".repeat(40)} ${"b".repeat(40)} refs/heads/${branch}`;
test("stolen capabilities expire within five minutes and cannot be changed", async () => {
  let now = Date.now();
  const service = new GitCapabilities(
    async () => "a sufficiently long test secret",
    () => now,
  );
  const issued = await service.issue({
    organizationId: "a",
    computerId: "c",
    workspaceId: "w",
    repository: "studio/release",
    branches: ["remy/release"],
    write: true,
  });
  assert.equal(
    (await service.read(issued.token))?.repository,
    "studio/release",
  );
  const [payload, signature] = issued.token.split(".");
  const altered = JSON.parse(Buffer.from(payload!, "base64url").toString());
  altered.repository = "studio/private";
  assert.equal(
    await service.read(
      `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`,
    ),
    undefined,
  );
  now += 299999;
  assert.ok(await service.read(issued.token));
  now++;
  assert.equal(await service.read(issued.token), undefined);
});
test("every pushed ref is checked, including multi-ref requests, deletes and malformed packets", () => {
  const encode = (s: string) => Buffer.from(s);
  assert.ok(
    validatePush(
      encode(
        packet(command("remy/release") + "\0report-status\n") + "0000PACK",
      ),
      ["remy/release"],
    ),
  );
  for (const body of [
    packet(command("main")) + "0000",
    packet(command("remy/release")) + packet(command("main")) + "0000",
    packet(command("remy/release").replace("b".repeat(40), "0".repeat(40))) +
      "0000",
    packet(command("remy/release").replace("refs/heads/", "refs/tags/")) +
      "0000",
    "0001",
    packet(command("remy/release")),
  ])
    assert.equal(validatePush(encode(body), ["remy/release"]), false);
});
test("proxy never forwards read-only writes, forbidden branches, redirects or guest headers", async () => {
  const grant = {
    organizationId: "o",
    computerId: "c",
    workspaceId: "w",
    repository: "studio/release",
    branches: ["remy/release"],
    write: false,
    expiresAt: Date.now() + 300000,
  };
  let calls = 0;
  const send: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(
      String(input),
      "https://github.com/studio/release.git/info/refs?service=git-upload-pack",
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), null);
    assert.equal(
      headers.get("authorization"),
      `Basic ${btoa("x-access-token:upstream-secret")}`,
    );
    return new Response("repository advertisement");
  };
  assert.equal(
    (
      await proxyGit(
        new Request("https://hub/git/w/info/refs?service=git-upload-pack", {
          headers: { cookie: "private" },
        }),
        grant,
        "info/refs",
        async () => "upstream-secret",
        send,
      )
    ).status,
    200,
  );
  assert.equal(calls, 1);
  for (const write of [false, true])
    assert.equal(
      (
        await proxyGit(
          new Request("https://hub/git/w/git-receive-pack", {
            method: "POST",
            body: packet(command("main")) + "0000",
          }),
          { ...grant, write },
          "git-receive-pack",
          async () => "upstream-secret",
          send,
        )
      ).status,
      403,
    );
  assert.equal(calls, 1);
  assert.equal(
    (
      await proxyGit(
        new Request("https://hub/git/w/info/refs?service=git-upload-pack"),
        grant,
        "info/refs",
        async () => "upstream-secret",
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.test" },
          }),
      )
    ).status,
    502,
  );
});
test("repository normalization cannot introduce a second URL or credentials", () => {
  for (const origin of [
    "https://github.com/Studio/Release.git",
    "git@github.com:Studio/Release.git",
    "github.com/Studio/Release",
  ])
    assert.equal(githubRepository(origin), "studio/release");
  for (const origin of [
    "https://evil.test/studio/release",
    "github.com/studio/release/extra",
    "https://token@github.com/studio/release",
    "github.com/studio/release?x=1",
  ])
    assert.equal(githubRepository(origin), undefined);
});
