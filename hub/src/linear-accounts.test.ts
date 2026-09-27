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
  clearLinearTicketCache,
  ticketIdentifiers,
} from "./linear-accounts.js";
import type { OrganizationService } from "./organizations.js";

function fixture(send?: typeof fetch) {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(
    readdirSync(folder)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(new URL(file, folder), "utf8"))
      .join("\n"),
  );
  sqlite.exec(
    "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@example.test',1,1),('grace','Grace','grace@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt,personal_owner_id) VALUES('studio','Studio',1,1,NULL),('personal','Personal',1,1,'ada'); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','studio','ada','owner',1,1),('m2','studio','grace','member',1,1),('m3','personal','ada','owner',1,1);",
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
    { send },
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

test("a Personal Linear choice is the organization fallback", async () => {
  const { accounts, save } = fixture();
  const accountId = await save("ada", "linear-studio", "secret-ada");
  await accounts.setLink("personal", "ada", accountId);
  assert.deepEqual(await accounts.view("studio", "ada").then((value) => value.link), {
    externalId: "linear-studio",
    label: "linear-studio",
  });
  const listed = await accounts.list("ada");
  assert.equal(listed[0].general, true);
  assert.deepEqual(listed[0].organizationIds, []);
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

test("identifiers come from a branch or title, uppercased, first seen first", () => {
  assert.deepEqual(ticketIdentifiers("padam/remy-214-search Fix REMY-214 and WRK-9"), ["REMY-214", "WRK-9"]);
  assert.deepEqual(ticketIdentifiers("feature/v2-3000x no-ticket"), []);
  assert.deepEqual(ticketIdentifiers("main"), []);
});

test("a pull request's ticket is its attachment, then its branch, then an identifier, as that member", async () => {
  clearLinearTicketCache();
  const asked: { query: string; variables: Record<string, unknown>; token: string }[] = [];
  let attached = true;
  const send = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    asked.push({ query: body.query, variables: body.variables, token: new Headers(init?.headers).get("authorization") ?? "" });
    if (body.query.includes("attachmentsForURL")) return Response.json({ data: { attachmentsForURL: { nodes: attached ? [{ issue: { identifier: "REMY-214", title: "Search repositories", url: "https://linear.app/remy/issue/REMY-214", state: { type: "started" } } }] : [] } } });
    if (body.query.includes("issueVcsBranchSearch")) return Response.json({ data: { issueVcsBranchSearch: null } });
    if (body.query.includes("issue(id")) return Response.json({ data: { issue: body.variables.id === "REMY-9" ? { identifier: "REMY-9", title: "Nine", url: "javascript:alert(1)", state: { type: "weird" } } : null } });
    return Response.json({});
  }) as typeof fetch;
  const { accounts, save } = fixture(send);
  const pull = { url: "https://github.com/release/remy/pull/7", branch: "padam/remy-9-nine", title: "Nine" };
  // Not connected: no ticket, and Linear is never asked.
  await assert.rejects(accounts.pullRequestTicket("studio", "ada", pull));
  assert.equal(asked.length, 0);
  await save("ada", "linear-studio", "secret-ada");
  await accounts.setLink("studio", "ada", (await accounts.list("ada"))[0].id);
  assert.deepEqual(await accounts.pullRequestTicket("studio", "ada", pull), { identifier: "REMY-214", title: "Search repositories", url: "https://linear.app/remy/issue/REMY-214", state: "started" });
  assert.equal(asked[0].token, "Bearer secret-ada");
  assert.deepEqual(asked[0].variables, { url: pull.url });
  // Cached per member and pull request.
  await accounts.pullRequestTicket("studio", "ada", pull);
  assert.equal(asked.length, 1);
  clearLinearTicketCache();
  attached = false;
  assert.deepEqual(await accounts.pullRequestTicket("studio", "ada", pull), { identifier: "REMY-9", title: "Nine", url: "", state: "" });
  assert.deepEqual(asked.slice(1).map((entry) => Object.values(entry.variables)[0]), [pull.url, "padam/remy-9-nine", "REMY-9"]);
});
