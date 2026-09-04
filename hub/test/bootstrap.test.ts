import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapDatabases } from "../scripts/bootstrap.js";

test("bootstrap creates both databases in an empty account", async () => {
  const databases: Array<{ name: string; uuid: string }> = [];
  const created: string[] = [];
  const result = await bootstrapDatabases({
    list: async () => databases,
    create: async (name) => {
      created.push(name);
      databases.push({ name, uuid: `${name}-id` });
    },
  });

  assert.deepEqual(created, ["remy-hub-staging", "remy-hub-production"]);
  assert.deepEqual(result, {
    "remy-hub-production": "remy-hub-production-id",
    "remy-hub-staging": "remy-hub-staging-id",
  });
  assert.deepEqual(
    await bootstrapDatabases({
      list: async () => databases,
      create: async (name) => {
        created.push(name);
      },
    }),
    result,
  );
  assert.deepEqual(created, ["remy-hub-staging", "remy-hub-production"]);
});

test("bootstrap reuses existing databases and rejects shared state", async () => {
  let created = false;
  const list = async () => [
    { name: "remy-hub-staging", uuid: "same-id" },
    { name: "remy-hub-production", uuid: "same-id" },
  ];
  await assert.rejects(
    bootstrapDatabases({
      list,
      create: async () => {
        created = true;
      },
    }),
    /different D1 databases/,
  );
  assert.equal(created, false);
});
