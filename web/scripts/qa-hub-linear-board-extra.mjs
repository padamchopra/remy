import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
const i = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8")),
  base = `${i.hubUrl}/api/organizations/${i.organizationId}`;
const api = async (path, method = "GET", body) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${i.tokens.ada}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(r.ok, await r.clone().text());
  return r.json();
};
const vendor = () =>
  fetch(i.controlUrl + "/linear", {
    headers: { authorization: `Bearer ${i.controlToken}` },
  }).then((r) => r.json());
const until = async (fn) => {
  for (let n = 0; n < 90; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Mirror timed out");
};
const b = await chromium.launch({ executablePath: chromiumPath() }),
  c = await b.newContext();
await c.addCookies([
  { name: "remy_session", value: i.tokens.ada, url: i.hubUrl },
]);
const p = await c.newPage();
const pick = async (label, name) => {
  await p.getByRole("combobox", { name: label, exact: true }).click();
  await p.getByRole("option", { name, exact: true }).click();
};
try {
  await p.goto(
    `${i.hubUrl}/#/settings/connections?organization=${i.organizationId}`,
  );
  if (
    await p
      .getByRole("button", { name: "Turn on Linear sync", exact: true })
      .count()
  )
    await p
      .getByRole("button", { name: "Turn on Linear sync", exact: true })
      .click();
  await p.getByText("Linear sync is on.", { exact: true }).waitFor();
  const tickets = (await api("/board/tickets")).items;
  const parent = tickets.find((t) => t.fields.linearIssueId);
  await p.goto(
    `${i.hubUrl}/#/tickets/${parent.id}?organization=${i.organizationId}`,
  );
  await p.getByRole("button", { name: "Create ticket", exact: true }).click();
  await p
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Check the release checklist");
  await pick("Ticket workspace", "Release workspace");
  await p.getByRole("combobox", { name: "Parent ticket", exact: true }).click();
  await p.getByRole("option").nth(1).click();
  await pick("Ticket status", "Todo");
  await p.getByRole("button", { name: "Save ticket", exact: true }).click();
  await until(async () =>
    (await vendor()).issues.some(
      (v) =>
        v.title === "Check the release checklist" &&
        v.parent?.id === parent.fields.linearIssueId,
    ),
  );
  const child = (await api("/board/tickets")).items.find(
    (t) => t.fields.title === "Check the release checklist",
  );
  await p.goto(
    `${i.hubUrl}/#/tickets/${child.id}?organization=${i.organizationId}`,
  );
  await p
    .getByRole("button", { name: "Open parent ticket", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Check the release checklist", exact: true })
    .waitFor();
  for (let n = 0; n < 50; n++) {
    await api("/board/events", "POST", {
      entity: "ticket",
      entityId: child.id,
      kind: "field",
      payload: { title: `Release checklist ${n}` },
    });
    await api("/board/events", "POST", {
      entity: "ticket",
      entityId: child.id,
      kind: "comment",
      payload: { text: `Verified release check ${n}` },
    });
  }
  await until(async () => {
    const v = await vendor();
    return (
      v.comments.filter((c) => c.body.startsWith("Verified release check"))
        .length === 50 &&
      v.issues.some((v) => v.title === "Release checklist 49")
    );
  });
  const comments = (await vendor()).comments.filter((c) =>
    c.body.startsWith("Verified release check"),
  );
  assert.equal(new Set(comments.map((c) => c.body)).size, 50);
  assert.equal(
    (await api(`/board/tickets/${child.id}`)).activity.filter(
      (a) => a.kind === "comment",
    ).length,
    50,
  );
  console.log(
    "PASS: sub-ticket picker, persisted sub-issue parent, parent navigation, 50 rapid changes and comments through real HTTP/queue/stream, no echoed comments",
  );
} finally {
  await c.close();
  await b.close();
}
