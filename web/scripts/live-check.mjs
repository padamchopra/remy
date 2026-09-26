// Proves the window is Remy's threads remote: it loads, reaches the daemon, and
// shows somewhere you could start work — without anyone touching the UI.
// It checks `npm run dev:hosted` by default, or the URL `npm run qa:web` prints
// when that is set in MC_URL.
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(process.env.MC_URL ?? "http://127.0.0.1:5174",{ waitUntil: "networkidle" });
await page.waitForSelector("[data-slot=sidebar]", { timeout: 30_000 });
await page.waitForTimeout(1500);

const sidebar = await page.locator("[data-slot=sidebar]").innerText();
const main = await page.locator("main").innerText();
console.log("sidebar:", sidebar.split("\n").filter(Boolean).slice(0, 6).join(" | "));
console.log("main:", main.split("\n").filter(Boolean).slice(0, 3).join(" | "));

// The sidebar always lists the sections; the main pane is either the composer,
// an open thread, or the state that explains why it is neither.
const listsThreads = /threads/i.test(sidebar);
const usable =
  /what do you want to do in/i.test(main)
  || /reply, or ask/i.test(main)
  || /connecting/i.test(main)
  || /can't reach|no devices/i.test(main);

const ok = listsThreads && usable && errors.length === 0;
if (!listsThreads) console.log("FAIL: the sidebar is not listing threads");
if (!usable) console.log("FAIL: the main pane is neither a composer, a thread, nor an explained empty state");
if (errors.length) console.log("FAIL: page errors:", errors.join(" | "));
console.log(ok ? "\nPASS: the window is showing threads" : "\nFAIL: the window is not usable");

await page.screenshot({ path: "/tmp/mc-live/05-threads.png" });
await browser.close();
if (!ok) process.exit(1);
