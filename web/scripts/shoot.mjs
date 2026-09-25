// Screenshot harness for the web window.
//
// The UI is a web app, served beside the daemon or by Vite in preview. This script
// renders states and interactions to PNGs that can be looked at directly.
//
// Uses Playwright's already-cached Chromium; nothing is downloaded.
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";


const URL = process.env.MC_URL ?? "http://127.0.0.1:5173";
const OUT = process.env.MC_OUT ?? "/tmp/mc-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });

const shoot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
};

console.log("captured:");
await shoot("01-main");

// The ⌘K palette.
await page.keyboard.press("Meta+k");
await page.waitForTimeout(350);
await shoot("02-palette");
await page.keyboard.type("sql");
await page.waitForTimeout(250);
await shoot("03-palette-filtered");
await page.keyboard.press("Escape");
await page.waitForTimeout(250);

// The sidebar is one column of sections now, so there is no popover to float
// and nothing to reflow.

if (errors.length) {
  console.log(`\nconsole errors (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.log("  " + e);
} else {
  console.log("no console errors");
}

await browser.close();
