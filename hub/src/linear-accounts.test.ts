import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { ConnectionVault, type ConnectionTokens } from "./connections.js";
import {
  LINEAR_MISSING_NOTICE,
  LINEAR_MCP_URL,
  LINEAR_REAUTH_NOTICE,
  LinearAccounts,
  assertLinearPerson,
} from "./linear-accounts.js";
import type { OrganizationService } from "./organizations.js";

function fixture() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(
    readdirSync(folder)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(new URL(file, folder), "utf8"))
      .join("\n"),
  );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('studio','Studio',1,1),('personal','Personal',1,1); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1),('m3','personal','ada','owner',1,1);",
  );
  const changes: string[] = [];
  const auth = {
    member: async (org: string, user: string) => {
      if (
        !sqlite
          .prepare("SELECT 1 FROM memberships WHERE organization_id=? AND user_id=?")
          .get(org, user)
      )
        throw Error("No membership");
      return { role: "member" };
    },
  } as unknown as OrganizationService;
  const accounts = new LinearAccounts(
    db,
    new ConnectionVault(async () => "root-secret"),
    auth,
    async (org) => {
      changes.push(org);
    },
    () => 1_000_000,
  );
  const save = (user: string, workspace: string, token: string) =>
    accounts.save(user, { access_token: token } satisfies ConnectionTokens, {
      id: workspace,
      label: workspace,
    });
  return { db, sqlite, accounts, changes, save };
}

test("connecting adds a row and a second workspace does not replace it", async () => {
  const { accounts, save, sqlite } = fixture();
  await save("ada", "linear-studio", "secret-studio");
  await save("ada", "linear-other", "secret-other");
  await save("ada", "linear-studio", "secret-studio-again");
  const listed = await accounts.list("ada");
  assert.deepEqual(
    listed.map((row) => row.externalId).sort(),
    ["linear-other", "linear-studio"],
  );
  assert.equal(listed.find((row) => row.externalId === "linear-studio")?.status, "connected");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM linear_accounts").get()?.n, 2);
  assert.equal(
    JSON.stringify(listed).includes("secret-studio") ||
      JSON.stringify(await accounts.view("studio", "ada")).includes("secret"),
    false,
  );
});

test("a member sees only their Linear accounts", async () => {
  const { accounts, save } = fixture();
  await save("ada", "linear-studio", "secret-ada");
  await save("grace", "linear-grace", "secret-grace");
  const ada = await accounts.list("ada");
  const grace = await accounts.list("grace");
  assert.deepEqual(ada.map((row) => row.externalId), ["linear-studio"]);
  assert.deepEqual(grace.map((row) => row.externalId), ["linear-grace"]);
  await assert.rejects(accounts.setLink("studio", "grace", ada[0].id));
});

test("leaving drops that person's sign-in and clears the workspace when nobody else has it", async () => {
  const { accounts, save, sqlite } = fixture();
  await save("ada", "linear-studio", "secret-ada");
  await save("grace", "linear-grace", "secret-grace");
  const ada = await accounts.list("ada");
  await accounts.setLink("studio", "ada", ada[0].id);
  sqlite.prepare("DELETE FROM memberships WHERE organization_id='studio' AND user_id='ada'").run();
  assert.equal(sqlite.prepare("SELECT count(*) n FROM linear_accounts WHERE user_id='ada'").get()?.n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM linear_accounts WHERE user_id='grace'").get()?.n, 1);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM organization_linear_links WHERE organization_id='studio'").get()?.n,
    0,
  );
  assert.equal((await accounts.link("personal")), null);
});

test("the organization keeps its workspace when another member still has that sign-in", async () => {
  const { accounts, save, sqlite } = fixture();
  await save("ada", "linear-studio", "secret-ada");
  await save("grace", "linear-studio", "secret-grace");
  await accounts.setLink("studio", "ada", (await accounts.list("ada"))[0].id);
  sqlite.prepare("DELETE FROM memberships WHERE organization_id='studio' AND user_id='ada'").run();
  assert.equal((await accounts.link("studio"))?.externalId, "linear-studio");
  assert.equal(
    JSON.stringify(sqlite.prepare("SELECT * FROM organization_linear_links").get()).includes("secret"),
    false,
  );
});

test("a thread gets Linear only when the organization link and that person's sign-in both exist", async () => {
  const { accounts, save } = fixture();
  assert.deepEqual(await accounts.forThread("studio", "ada"), { kind: "off" });
  await save("ada", "linear-studio", "secret-ada");
  const account = (await accounts.list("ada"))[0];
  assert.equal((await accounts.forThread("studio", "ada")).kind, "off");
  await accounts.setLink("studio", "ada", account.id);
  const ready = await accounts.forThread("studio", "ada");
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") return;
  assert.equal(ready.token, "secret-ada");
  assert.equal(ready.url, LINEAR_MCP_URL);
  assert.equal(await accounts.forThread("studio", "grace").then((row) => row.kind === "notice" && row.notice), LINEAR_MISSING_NOTICE);
  assert.equal(await accounts.accessNotice("studio", "ada"), null);
  assert.equal(JSON.stringify({ notice: await accounts.accessNotice("studio", "grace") }).includes("secret-ada"), false);
  await accounts.disconnect("ada", account.id);
  assert.equal((await accounts.link("studio")), null);
  assert.deepEqual(await accounts.forThread("studio", "ada"), { kind: "off" });
});

test("a sign-in that needs reconnect keeps the link and withholds the token", async () => {
  const { accounts, save, sqlite } = fixture();
  await save("ada", "linear-studio", "secret-ada");
  const account = (await accounts.list("ada"))[0];
  await accounts.setLink("studio", "ada", account.id);
  sqlite.prepare("UPDATE linear_accounts SET status='reauth' WHERE id=?").run(account.id);
  const access = await accounts.forThread("studio", "ada");
  assert.deepEqual(access, { kind: "notice", notice: LINEAR_REAUTH_NOTICE });
  assert.equal((await accounts.link("studio"))?.externalId, "linear-studio");
  assert.equal(await accounts.accessNotice("studio", "ada"), LINEAR_REAUTH_NOTICE);
});

test("a computer cannot connect or disconnect Linear", () => {
  assert.throws(() => assertLinearPerson("computer"), /Connect Linear from Remy/);
  assert.doesNotThrow(() => assertLinearPerson("web"));
});
