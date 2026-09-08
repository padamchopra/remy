import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8")),
  out = process.env.QA_ARTIFACTS;
mkdirSync(out, { recursive: true });
const base = `${info.hubUrl}/api/organizations/${info.organizationId}`;
const call = async (path, method = "GET", body) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${info.tokens.ada}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = r.status === 204 ? null : await r.json();
  assert.ok(r.ok, JSON.stringify(value));
  return value;
};
const control = async (path, body) => {
  const r = await fetch(info.controlUrl + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${info.controlToken}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(r.ok);
  return r.status === 204 ? null : r.json();
};
const until = async (fn) => {
  for (let n = 0; n < 90; n++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Timed out waiting for mirror");
};
const workspace = await call("/workspaces", "POST", {
  name: "Release workspace",
  origin: "https://example.test/studio/release.git",
});
await call("/routing", "PUT", {
  rules: [
    { id: "studio", name: "Studio", target: { computerId: info.computerId } },
  ],
});
const agentId = crypto.randomUUID();
await call("/board/events", "POST", {
  entity: "agent",
  entityId: agentId,
  kind: "create",
  payload: {
    name: "Release partner",
    handle: agentId,
    scope: "org",
    ownerId: info.organizationId,
    instructions: "Work on organization tickets.",
  },
});
const browser = await chromium.launch({ executablePath: chromiumPath() }),
  context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    colorScheme: "dark",
    recordVideo: { dir: out, size: { width: 1280, height: 1000 } },
  });
await context.addCookies([
  {
    name: "remy_session",
    value: info.tokens.ada,
    url: info.hubUrl,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const page = await context.newPage();
const route = `${info.hubUrl}/#/settings/connections?organization=${info.organizationId}`;
const pick = async (label, option) => {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
try {
  await page.goto(route);
  await page
    .getByRole("button", { name: "Connect Linear", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Allow connection", exact: true })
    .click();
  await page.getByText("Release team · Connected", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Refresh Linear teams", exact: true })
    .click();
  await page.getByText("Engineering · ENG", { exact: true }).waitFor();
  await pick("Remy workspace", "Release workspace");
  await pick("Linear team", "Engineering · ENG");
  await pick("Linear grouping", "September release");
  await page
    .getByRole("button", { name: "Save Linear mapping", exact: true })
    .click();
  await page
    .getByText("Your workspace mapping is saved.", { exact: true })
    .waitFor();
  await pick("Match Ada", "Ada");
  await page
    .getByText("Your member match is saved.", { exact: true })
    .waitFor();
  await pick("Agent for Remy", "Release partner");
  await page
    .getByRole("button", { name: "Turn on Linear sync", exact: true })
    .click();
  await page.getByText("Linear sync is on.", { exact: true }).waitFor();
  const tickets = async () => {
    const result = await call("/board/tickets");
    return result.items ?? result.tickets;
  };
  const ticket = await until(async () =>
    (await tickets()).find((t) => t.fields.linearIssueId),
  );
  const issueId = ticket.fields.linearIssueId;
  assert.equal(ticket.fields.keyPrefix, "ENG");
  await page.goto(
    `${info.hubUrl}/#/tickets/${ticket.id}?organization=${info.organizationId}`,
  );
  await page
    .getByRole("button", { name: "Edit ticket", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Open in Linear", exact: true })
    .waitFor();
  await control("/linear-edit", {
    id: issueId,
    patch: {
      title: "Verify September release notes",
      state: { id: "linear-working", name: "In progress" },
    },
  });
  await page
    .getByRole("combobox", {
      name: "Status for Verify September release notes",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("combobox", {
        name: "Status for Verify September release notes",
        exact: true,
      })
      .innerText(),
    "In progress",
  );
  await page.getByRole("button", { name: "Edit ticket", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Check the release notes before publishing.");
  await pick("Ticket status", "Done");
  await pick("Ticket assignee", "Ada");
  await page.getByRole("checkbox", { name: "Release", exact: true }).uncheck();
  await page.getByRole("button", { name: "Save ticket", exact: true }).click();
  await until(async () => {
    const i = (await control("/linear")).issues.find((i) => i.id === issueId);
    return (
      i.state.id === "linear-done" &&
      i.description === "Check the release notes before publishing." &&
      i.assignee?.id === "linear-ada" &&
      i.labels.nodes.length === 0
    );
  });
  await page
    .getByRole("textbox", { name: "Ticket comment", exact: true })
    .fill("The release notes are ready for a final review.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await until(async () =>
    (await control("/linear")).comments.some((c) =>
      c.body.includes("ready for a final review"),
    ),
  );
  await page.screenshot({ path: out + "/ticket.png" });
  await control("/linear-edit", {
    id: issueId,
    patch: {
      assignee: { id: "linear-agent", name: "Remy" },
      state: { id: "linear-working", name: "In progress" },
    },
  });
  await until(async () =>
    (await control("/linear")).comments.some((c) =>
      c.body.includes("release notes are checked and ready"),
    ),
  );
  const final = await call(`/board/tickets/${ticket.id}`);
  assert.ok(final.fields.threads.length);
  const link = final.fields.threads.at(-1);
  const thread = await call(
    `/computers/${link.computerId}/threads/${link.chatId}`,
  );
  assert.equal(thread.access.visibility, "open");
  await page
    .getByText("I checked the release notes and started verification.", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: out + "/agent.png" });
  await page.goto(route);
  await page
    .getByRole("button", { name: "Turn off Linear sync", exact: true })
    .click();
  await page.getByText("Linear sync is off.", { exact: true }).waitFor();
  await control("/linear-edit", {
    id: issueId,
    patch: { title: "Only in Linear after sync is off" },
  });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(
    (await call(`/board/tickets/${ticket.id}`)).fields.title,
    "Verify September release notes",
  );
  assert.ok((await control("/linear")).issues.length);
  await page.reload();
  await page.getByText("Linear sync is off.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Turn on Linear sync", exact: true })
    .scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .getByRole("region", { name: "Connections", exact: true })
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await page.screenshot({ path: out + "/mobile.png" });
  console.log(
    "PASS: real OAuth, signed webhook queue, Linear slug/import/live status, Remy fields/assignee/labels/comment export, mapped assignment routes an open agent thread with MCP comments and linked reply, off preserves both, reload and narrow layout",
  );
} catch (e) {
  console.error(e);
  await page.screenshot({ path: out + "/failure.png" });
  console.error(await page.locator("body").innerText());
  throw e;
} finally {
  await context.close();
  await browser.close();
}
console.log(`VIDEO=${await page.video().path()}`);
