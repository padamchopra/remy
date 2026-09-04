import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION } from "@remy/contract";

import { deployHub, deploymentHubUrl } from "../scripts/deploy.js";

test("production smoke checks the URL owned by its Worker configuration", () => {
  assert.equal(deploymentHubUrl("production"), "https://remy-prod.jb-padamchopra.workers.dev");
});

test("migration failure prevents secret update, deployment, and smoke check", async () => {
  const commands: string[][] = [];
  let fetched = false;

  await assert.rejects(
    deployHub({
      authSecret: "secret",
      environment: "staging",
      hubUrl: "https://staging.example",
      release: "abc123",
      run: async (_file, args) => {
        commands.push(args);
        throw new Error("migration rejected");
      },
      fetchHealth: async () => {
        fetched = true;
        return Response.json({});
      },
    }),
    /migration rejected/,
  );

  assert.deepEqual(commands, [["d1", "migrations", "apply", "DB", "--remote", "--env", "staging"]]);
  assert.equal(fetched, false);
});

test("deployment migrates, injects the secret, deploys, then validates health", async () => {
  const commands: Array<{ args: string[]; input?: string }> = [];
  await deployHub({
    authSecret: "auth-secret",
    environment: "production",
    hubUrl: "https://production.example",
    release: "abc123",
    run: async (_file, args, input) => {
      commands.push(input === undefined ? { args } : { args, input });
    },
    fetchHealth: async (input) => {
      assert.equal(String(input), "https://production.example/health");
      return Response.json({ contractVersion: CONTRACT_VERSION, environment: "production", release: "abc123" });
    },
  });

  assert.equal(commands[0]?.args[0], "d1");
  assert.deepEqual(commands[1], {
    args: ["secret", "put", "BETTER_AUTH_SECRET", "--env", "production"],
    input: "auth-secret",
  });
  assert.equal(commands[2]?.args[0], "deploy");
  assert.ok(commands[2]?.args.includes("RELEASE:abc123"));
});

test("deployment command failure prevents the smoke check", async () => {
  let command = 0;
  let fetched = false;
  await assert.rejects(
    deployHub({
      authSecret: "secret",
      environment: "staging",
      hubUrl: "https://staging.example",
      release: "abc123",
      run: async () => {
        command++;
        if (command === 3) throw new Error("deploy rejected");
      },
      fetchHealth: async () => {
        fetched = true;
        return Response.json({});
      },
    }),
    /deploy rejected/,
  );
  assert.equal(fetched, false);
});
