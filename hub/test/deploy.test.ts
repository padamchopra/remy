import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION } from "@remy/contract";

import { deployHub, deploymentHubUrl } from "../scripts/deploy.js";

test("production smoke checks the URL owned by its Worker configuration", () => {
  assert.equal(deploymentHubUrl("production"), "https://tryremy.dev");
});

test("staging smoke checks its custom domain", () => {
  assert.equal(deploymentHubUrl("staging"), "https://staging.tryremy.dev");
});

test("migration failure prevents deployment and smoke check", async () => {
  const commands: string[][] = [];
  let fetched = false;

  await assert.rejects(
    deployHub({
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

test("deployment migrates, deploys, then validates health", async () => {
  const commands: string[][] = [];
  await deployHub({
    environment: "production",
    hubUrl: "https://production.example",
    release: "abc123",
    run: async (_file, args) => {
      commands.push(args);
    },
    fetchHealth: async (input) => {
      assert.equal(String(input), "https://production.example/health");
      return Response.json({
        contractVersion: CONTRACT_VERSION,
        environment: "production",
        release: "abc123",
        status: "ok",
        dependencies: {
          database: "ready", coordinator: "ready", objectStore: "ready", queue: "ready", secrets: "ready",
        },
      });
    },
  });

  assert.equal(commands[0]?.[0], "d1");
  assert.equal(commands[1]?.[0], "deploy");
  assert.ok(commands[1]?.includes("RELEASE:abc123"));
});

test("deployment command failure prevents the smoke check", async () => {
  let command = 0;
  let fetched = false;
  await assert.rejects(
    deployHub({
      environment: "staging",
      hubUrl: "https://staging.example",
      release: "abc123",
      run: async () => {
        command++;
        if (command === 2) throw new Error("deploy rejected");
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
