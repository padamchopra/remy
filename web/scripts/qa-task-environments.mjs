import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
const i = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = `${i.hubUrl}/api/organizations/${i.organizationId}`;
const out = process.env.QA_ARTIFACTS;
mkdirSync(out, { recursive: true });
const call = async (path, method = "GET", body, user = "ada") => {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${i.tokens[user]}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const workspace = (
  await call("/workspaces", "POST", {
    name: "Website",
    origin: "https://example.test/studio/website.git",
  })
).body;
const b = await chromium.launch({ executablePath: chromiumPath() });
const c = await b.newContext({
  viewport: { width: 1280, height: 1000 },
  colorScheme: "dark",
  recordVideo: { dir: out, size: { width: 1280, height: 1000 } },
});
await c.addCookies([
  {
    name: "remy_session",
    value: i.tokens.ada,
    url: i.hubUrl,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
await c.addInitScript(() =>
  document.addEventListener("DOMContentLoaded", () => {
    const p = document.createElement("div");
    p.style.cssText =
      "position:fixed;width:14px;height:14px;border:2px solid white;border-radius:50%;background:#222;pointer-events:none;z-index:2147483647;left:10px;top:10px";
    document.body.append(p);
    document.addEventListener("pointermove", (e) => {
      p.style.left = `${e.clientX - 7}px`;
      p.style.top = `${e.clientY - 7}px`;
    });
    document.addEventListener(
      "pointerdown",
      () =>
        p.animate(
          [
            { boxShadow: "0 0 0 0 #f5c451" },
            { boxShadow: "0 0 0 18px transparent" },
          ],
          { duration: 650 },
        ),
      true,
    );
  }),
);
const p = await c.newPage();
let profile;
const click = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  const r = await loc.boundingBox();
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 20 });
  await p.waitForTimeout(400);
  await loc.click();
  await p.waitForTimeout(1000);
};
const type = async (label, text) => {
  const input = p.getByLabel(label, { exact: true });
  await click(input);
  await input.pressSequentially(text, { delay: 85 });
  await p.waitForTimeout(800);
};
try {
  await p.goto(
    `${i.hubUrl}/app/#/settings/environments?organization=${i.organizationId}`,
  );
  await type("Environment name", "Development");
  await click(p.getByRole("button", { name: "Add environment", exact: true }));
  await type("Variable name", "QA_GREETING");
  await type("Value", "disposable-environment-value");
  await click(p.getByRole("button", { name: "Save value", exact: true }));
  const data = (await call("/environments")).body;
  profile = data.environments.find((e) => e.name === "Development");
  assert.ok(profile);
  assert.ok(!JSON.stringify(data).includes("disposable-environment-value"));
  await click(
    p.getByRole("combobox", { name: "Environment for Website", exact: true }),
  );
  await click(p.getByRole("option", { name: "Development", exact: true }));
  await p.mouse.move(8, 8);
  await p.waitForTimeout(1800);
  await p.screenshot({ path: out + "/environments.png" });

  assert.equal(
    (await call("/environments", "GET", undefined, "grace")).status,
    403,
  );
  assert.equal(
    (
      await call(`/environments/${workspace.id}/assign`, "PUT", {
        environmentId: "missing",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/hosted", "PUT", {
        settings: { enabled: true, provider: "modal", maxComputers: 2 },
      })
    ).status,
    200,
  );
  const start = () =>
    call("/threads", "POST", {
      workspaceId: workspace.id,
      title: "Check the environment",
      requestId: crypto.randomUUID(),
    });
  const [a, d] = await Promise.all([start(), start()]);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.notEqual(a.body.computerId, d.body.computerId);
  for (const task of [a.body, d.body]) {
    const path = `/computers/${task.computerId}/threads/${task.id}`;
    const sent = await call(path + "/message", "POST", {
      text: "Check this task environment.",
      messageId: "u-" + crypto.randomUUID(),
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    let thread;
    for (let n = 0; n < 100; n++) {
      thread = (await call(path)).body;
      if (
        thread.detail?.entries.some(
          (e) => e.text === "Your assigned environment is applied.",
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      thread.detail.entries.some(
        (e) => e.text === "Your assigned environment is applied.",
      ),
      JSON.stringify(thread.detail.entries),
    );
  }
  await p.goto(
    `${i.hubUrl}/app/#/threads/${a.body.id}?organization=${i.organizationId}&computer=${a.body.computerId}`,
  );
  await p
    .getByText("Your assigned environment is applied.", { exact: true })
    .first()
    .waitFor();
  await p.mouse.move(8, 8);
  await p.waitForTimeout(2200);
  await p.screenshot({ path: out + "/task-environment.png" });
  await c.close();
  const limited = await start();
  assert.equal(limited.status, 409);
  assert.match(limited.body.error, /concurrency limit/);
  const narrow = await b.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
  });
  await narrow.addCookies([
    {
      name: "remy_session",
      value: i.tokens.ada,
      url: i.hubUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const m = await narrow.newPage();
  await m.goto(
    `${i.hubUrl}/app/#/settings/environments?organization=${i.organizationId}`,
  );
  await m
    .getByRole("combobox", { name: "Environment for Website", exact: true })
    .waitFor();
  assert.ok(
    await m
      .locator("main")
      .first()
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await m.screenshot({ path: out + "/mobile-environments.png" });
  await narrow.close();
  console.log(
    "PASS: reusable environment UI, hidden values, workspace assignment, two isolated task computers, automatic environment application, concurrency limit, member denial and mobile layout",
  );
  console.log("VIDEO=" + (await p.video().path()));
} catch (error) {
  if (!p.isClosed()) await p.screenshot({ path: out + "/failure.png" });
  throw error;
} finally {
  await b.close();
  await call(`/workspaces/${workspace.id}`, "DELETE");
  if (profile) await call(`/environments/${profile.id}`, "DELETE");
  await call("/hosted", "PUT", { settings: { enabled: false } });
}
