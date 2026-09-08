import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
await fetch(info.controlUrl + "/restore-grace", {
  method: "POST",
  headers: { authorization: `Bearer ${info.controlToken}` },
});
const base = process.env.QA_WEB_URL;
const out = process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/wrk-10";
mkdirSync(out, { recursive: true });
const bootstrap = await fetch(
  `${info.hubUrl}/api/organizations/${info.organizationId}/computers`,
  { headers: { authorization: `Bearer ${info.tokens.ada}` } },
).then((r) => r.json());
const started = await fetch(
  `${info.hubUrl}/api/organizations/${info.organizationId}/computers/${info.computerId}/threads`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${info.tokens.ada}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: bootstrap.computers[0].capabilities.workspaces[0].id,
      title: "Prepare the release notes",
    }),
  },
).then((r) => r.json());
assert.equal(started.access.visibility, "private");
info.threadId = started.id;
const route = `${base}/#/threads/${info.threadId}?organization=${info.organizationId}&computer=${info.computerId}`;
const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
  colorScheme: "dark",
  recordVideo: { dir: out, size: { width: 1280, height: 850 } },
});
await context.addCookies([
  {
    name: "remy_session",
    value: info.tokens.ada,
    url: base,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const page = await context.newPage();
const teammateContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
});
await teammateContext.addCookies([
  {
    name: "remy_session",
    value: info.tokens.grace,
    url: base,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const teammate = await teammateContext.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const requests = [];
page.on("request", (request) => {
  if (request.url().includes("/api/organizations"))
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
    });
});
const path = `/api/organizations/${info.organizationId}/computers/${info.computerId}/threads/${info.threadId}`;
const call = async (member, suffix, body, method = "POST") => {
  const response = await fetch(info.hubUrl + path + suffix, {
    method,
    headers: {
      authorization: `Bearer ${info.tokens[member]}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
try {
  await page.goto(route);
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Open to organization", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Make private", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Review the release notes with me.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText("I’m checking the release notes with your latest feedback.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (
      await call("grace", "/message", {
        text: "Not joined",
        messageId: `u-${crypto.randomUUID()}`,
      })
    ).status,
    403,
  );
  await teammate.goto(route);
  const hideSidebar = teammate.getByRole("button", {
    name: "Hide sidebar",
    exact: true,
  });
  if (await hideSidebar.isVisible()) await hideSidebar.click();
  await teammate
    .getByRole("button", { name: "Join thread", exact: true })
    .click();
  await teammate
    .getByRole("button", { name: "Join thread", exact: true })
    .waitFor({ state: "hidden" });
  const catalogueBefore = requests.filter(
    (request) => request.path.endsWith("/threads") && request.method === "GET",
  ).length;
  await teammate
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Check the upgrade instructions too.");
  await teammate
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await page
    .getByText("Check the upgrade instructions too.", { exact: true })
    .waitFor();
  assert.equal(
    requests.filter(
      (request) =>
        request.path.endsWith("/threads") && request.method === "GET",
    ).length,
    catalogueBefore,
  );
  assert.equal(page.url(), route);
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Ask for approval before continuing.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Allow once", exact: true }).waitFor();
  const waiting = await call("ada", "", undefined, "GET");
  await teammate
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await page.getByText("Allowed permission.", { exact: true }).waitFor();
  assert.equal(
    (
      await call("ada", "/approval", {
        requestId: waiting.body.detail.approval.requestId,
        decision: "allow",
      })
    ).status,
    409,
  );
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Ask a question about the release.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByLabel("Which release should I prepare?", { exact: true })
    .waitFor();
  await page
    .getByLabel("Which release should I prepare?", { exact: true })
    .fill("Stable");
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await page
    .getByText("Which release should I prepare?\nStable", { exact: true })
    .waitFor();
  const png = readFileSync(new URL("../public/favicon.png", import.meta.url));
  await page.getByLabel("Attach image", { exact: true }).setInputFiles({
    name: "release-mark.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByText("1 attached", { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Use this release mark.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("img", { name: "release-mark.png", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("img", { name: "release-mark.png", exact: true })
      .evaluate((image) => image.complete && image.naturalWidth > 0),
    true,
  );
  const control = async (action) => {
    const response = await fetch(info.controlUrl + action, {
      method: "POST",
      headers: { authorization: `Bearer ${info.controlToken}` },
    });
    assert.equal(response.status, 204);
  };
  await control("/disconnect");
  await page
    .getByText(
      "This computer is offline; you’re reading its last saved update.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await call("ada", "", undefined, "GET")).body.stale, true);
  assert.equal(
    (
      await call("ada", "/message", {
        text: "Offline write",
        messageId: `u-${crypto.randomUUID()}`,
      })
    ).status,
    503,
  );
  await page.screenshot({ path: join(out, "offline.png") });
  await control("/reconnect");
  await page
    .getByText(
      "This computer is offline; you’re reading its last saved update.",
      { exact: true },
    )
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByText("Check the upgrade instructions too.", { exact: true })
      .count(),
    1,
  );
  const socketReads = requests.filter(
    (request) => request.path.endsWith("/threads") && request.method === "GET",
  ).length;
  await context.setOffline(true);
  await page.waitForTimeout(200);
  await context.setOffline(false);
  await page.waitForTimeout(1000);
  assert.equal(
    requests.filter(
      (request) =>
        request.path.endsWith("/threads") && request.method === "GET",
    ).length,
    socketReads,
  );
  await control("/reset");
  await page.waitForTimeout(1000);
  const beforeReload = page.url();
  await page.reload();
  await page
    .getByText("Check the upgrade instructions too.", { exact: true })
    .waitFor();
  assert.equal(page.url(), beforeReload);
  assert.equal(
    await page
      .getByText("Check the upgrade instructions too.", { exact: true })
      .count(),
    1,
  );
  const overflow = await page
    .locator('[aria-label="Team threads"]')
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  assert.equal(overflow, false);
  await page.screenshot({ path: join(out, "desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, "mobile.png") });
  assert.equal(
    await page
      .locator('[aria-label="Team threads"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  for (const [label, expected] of [
    ["Decline", "Declined permission."],
    ["Always allow", "Always allowed permission."],
  ]) {
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(`Request approval: ${label}.`);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByText(expected, { exact: true }).waitFor();
  }
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Check one more release detail.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Stop turn", exact: true }).click();
  await page.getByRole("button", { name: "Make private", exact: true }).click();
  await page
    .getByRole("button", { name: "Open to organization", exact: true })
    .waitFor();
  assert.equal(
    (await call("computer-owner", "", undefined, "GET")).status,
    404,
  );
  assert.equal((await call("grace", "", undefined, "GET")).status, 200);
  await control("/revoke-grace");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep this follow-up with the remaining participants.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await teammate.getByText("Sign in again.", { exact: true }).waitFor();
  assert.equal(
    await teammate
      .getByText("Keep this follow-up with the remaining participants.", {
        exact: true,
      })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      video: await page.video().path(),
      requests,
      desktop: join(out, "desktop.png"),
      mobile: join(out, "mobile.png"),
    }),
  );
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") });
  console.error("Visible page:", await page.locator("body").innerText());
  throw error;
} finally {
  await teammateContext.close();
  await context.close();
  await browser.close();
}
