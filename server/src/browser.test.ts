import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-browser-tabs-"));
const { browserView, browserViewportSize, closeBrowser } = await import("./browser.js");

test("browser viewport presets use responsive QA dimensions", () => {
  assert.deepEqual(browserViewportSize("desktop"), { width: 1280, height: 800 });
  assert.deepEqual(browserViewportSize("mobile"), { width: 390, height: 844 });
});

test("browser tabs keep independent inactive views", async () => {
  const first = await browserView("chat-one", false, "browser-one");
  const second = await browserView("chat-one", false, "browser-two");

  assert.equal(first.browserId, "browser-one");
  assert.equal(second.browserId, "browser-two");
  assert.equal(first.viewport, "desktop");
  assert.equal(second.viewport, "desktop");
  assert.equal(first.active, false);
  assert.equal(second.active, false);

  await closeBrowser("chat-one");
});
