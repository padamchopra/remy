// A deterministic, read-only performance gate for the shipped and current UI.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import {
  PERFORMANCE_BUDGETS,
  budgetFailures,
  createFixture,
  groupRequests,
  installPerformanceBridge,
  percentile,
} from "./perf-fixture.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = positiveInteger(process.env.MC_RUNS, 3);
const LIVE_SAMPLES = positiveInteger(process.env.MC_LIVE_SAMPLES, 20);
const TIMEOUT_MS = positiveInteger(process.env.MC_PERF_TIMEOUT_MS, 10_000);
const ENTRY_COUNTS = integerList(process.env.MC_PERF_ENTRY_COUNTS, [10, 100, 500]);
const ONLY_SCENARIO = process.env.MC_PERF_ONLY;
/// What `warm-latency` has the fixture device take to answer. See the scenario.
const WARM_LATENCY_MS = positiveInteger(process.env.MC_PERF_READ_DELAY_MS, 150);

/// Every work surface a thread leaves on the network until it opens: what the
/// first open costs, what the second one costs, and whether the pane moved
/// while the code was still arriving.
///
/// Every tool is a tab in the thread's workbench, added from the strip's menu.
const DEFERRED_TOOLS = [
  { id: "browser", label: "Browser" },
  { id: "pull-request", label: "Pull request" },
  { id: "analytics", label: "Analytics" },
  { id: "performance", label: "Performance" },
];

const TERMINAL_READY = `!!document.querySelector('section[aria-label="Terminal"]')`;

const targets = performanceTargets();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--allow-file-access-from-files"],
});
const results = [];

try {
  for (const target of targets) {
    console.log(`\n${target.name} — ${target.url}`);
    if (ONLY_SCENARIO === "sidebar") {
      for (const threadCount of [25, 250]) {
        results.push(await repeated(() => runSidebar(target, threadCount)));
      }
      if (target.name !== "packaged") results.push(await runSidebarBehavior(target));
      continue;
    }
    if (ONLY_SCENARIO === "surfaces") {
      results.push(...await runDeferredSurfaces(target));
      continue;
    }
    if (ONLY_SCENARIO !== "lifecycle") {
      for (const entryCount of ENTRY_COUNTS) {
        results.push(await repeated(() => runThreadOpen(target, entryCount)));
      }
    }
    if (ONLY_SCENARIO === "thread") continue;
    if (ONLY_SCENARIO === "lifecycle") {
      results.push(...await repeatedGroup(() => runThreadLifecycle(target)));
      results.push(await runWarmOffline(target));
      results.push(await repeated(() => runWarmLatency(target)));
      results.push(await runCatalogueGap(target));
      continue;
    }
    for (const threadCount of [25, 250]) {
      results.push(await repeated(() => runSidebar(target, threadCount)));
    }
    if (target.name !== "packaged") results.push(await runSidebarBehavior(target));
    results.push(...await runRenderIsolation(target));
    results.push(...await repeatedGroup(() => runThreadLifecycle(target)));
    results.push(await runWarmOffline(target));
    results.push(await repeated(() => runWarmLatency(target)));
    results.push(await runCatalogueGap(target));
    results.push(await repeated(() => runUnavailableDevice(target)));
    results.push(...await runPaneRoutes(target));
    results.push(...await runDeferredSurfaces(target));
    results.push(await runSharedReadFailure(target));
  }
} finally {
  await browser.close();
}

async function runRenderIsolation(target) {
  const local = createFixture({ threadCount: 25, entryCount: 10 });
  const inbox = createFixture({ threadCount: 25, entryCount: 10, agentCount: 25 });
  const remote = createFixture({ threadCount: 25, entryCount: 10, serverId: "peer-device" });
  return [
    await profileIsolatedRow({
      target,
      fixture: local,
      scenario: "render-isolation-thread",
      hash: `#/threads/${local.primaryThreadId}`,
      rowSurface: "thread-row",
      rowId: local.primaryThreadId,
    }),
    await profileIsolatedRow({
      target,
      fixture: inbox,
      scenario: "render-isolation-inbox",
      hash: `#/inbox/${inbox.primaryAgentHandle}`,
      rowSurface: "inbox-row",
      rowId: "agent-1",
      chatId: inbox.primaryDmId,
    }),
    await profileIsolatedRow({
      target,
      fixture: remote,
      scenario: "render-isolation-peer",
      hash: `#/threads/${remote.primaryThreadId}`,
      rowSurface: "thread-row",
      rowId: remote.primaryThreadId,
    }),
  ];
}

async function profileIsolatedRow({ target, fixture, scenario, hash, rowSurface, rowId, chatId = fixture.primaryThreadId }) {
  const opened = await openHarnessPage(target, fixture, hash);
  try {
    await waitForText(opened.page, fixture.lastEntryText);
    const beforeOrder = rowSurface === "thread-row" ? await visibleThreadOrder(opened.page, fixture) : [];
    await opened.page.evaluate(() => window.__remyPerf.resetMeasurements());
    const marker = `${scenario} marker`;
    await emitChatFrame(opened.page, chatId, marker);
    await waitForText(opened.page, marker);
    await nextPaint(opened.page);
    const profile = await opened.page.evaluate(({ surface, affectedId }) => {
      const rows = window.__remyPerf.renders.filter((render) => render.surface === surface);
      return {
        affectedRowRenders: rows.filter((render) => render.id === affectedId).length,
        unrelatedRowRenders: rows.filter((render) => render.id !== affectedId).length,
        renderedRowIds: [...new Set(rows.map((render) => render.id))],
      };
    }, { surface: rowSurface, affectedId: rowId });
    const afterOrder = rowSurface === "thread-row" ? await visibleThreadOrder(opened.page, fixture) : [];
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario,
      threadCount: fixture.threadCount,
      ...profile,
      orderChanged: beforeOrder.join("\u0000") !== afterOrder.join("\u0000"),
    });
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function visibleThreadOrder(page, fixture) {
  return page.evaluate((titles) => {
    const remaining = new Set(titles);
    const ordered = [];
    for (const row of document.querySelectorAll('[data-sidebar="menu-button"]')) {
      const text = row.textContent ?? "";
      for (const title of remaining) {
        if (!text.includes(title)) continue;
        ordered.push(title);
        remaining.delete(title);
        break;
      }
    }
    return ordered;
  }, fixture.responses["/chats"].chats.map((chat) => chat.title));
}

printResults(results);
const measuredResults = results.flatMap((result) => result.related ? [result, result.related] : [result]);
const failures = measuredResults.flatMap((result) =>
  budgetFailures(result).map((failure) => `${result.target} / ${result.scenario}: ${failure}`));

if (failures.length > 0) {
  console.error("\nREGRESSION");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nOK: every performance budget passed.");
}

function positiveInteger(raw, fallback) {
  const parsed = Number(raw ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function integerList(raw, fallback) {
  if (!raw) return fallback;
  const values = raw.split(",").map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isInteger(value) || value < 1)) return fallback;
  return values;
}

function performanceTargets() {
  if (process.env.MC_URL) {
    return [{ name: process.env.MC_PERF_LABEL ?? "configured", url: process.env.MC_URL }];
  }

  const requested = new Set(
    (process.env.MC_PERF_TARGETS ?? "packaged,isolated")
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean),
  );
  const known = new Set(["packaged", "isolated"]);
  const unknown = [...requested].filter((target) => !known.has(target));
  if (unknown.length > 0) throw new Error(`Unknown MC_PERF_TARGETS value: ${unknown.join(", ")}`);

  const selected = [];
  if (requested.has("packaged")) {
    const packagedIndex = process.env.MC_PACKAGED_WEB
      ?? "/Applications/Remy.app/Contents/Resources/web/index.html";
    if (!existsSync(packagedIndex)) {
      throw new Error(
        `The packaged Remy web bundle was not found at ${packagedIndex}. `
        + "Set MC_PACKAGED_WEB or run with MC_PERF_TARGETS=isolated.",
      );
    }
    selected.push({ name: "packaged", url: pathToFileURL(packagedIndex).href });
  }
  if (requested.has("isolated")) {
    const isolatedIndex = resolve(webRoot, "dist/index.html");
    if (!existsSync(isolatedIndex)) {
      throw new Error(`The isolated build is missing at ${isolatedIndex}. Run npm --prefix web run build first.`);
    }
    selected.push({ name: "isolated", url: pathToFileURL(isolatedIndex).href });
  }
  if (selected.length === 0) throw new Error("MC_PERF_TARGETS must select at least one target.");
  return selected;
}

async function repeated(run) {
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) samples.push(await run());
  return combineRuns(samples);
}

async function repeatedGroup(run) {
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) samples.push(await run());
  return samples[0].map((_result, index) => combineRuns(samples.map((sample) => sample[index])));
}

function combineRuns(samples) {
  if (samples.length === 1) return samples[0];
  const representative = [...samples].sort((left, right) =>
    (left.firstUsefulPaintMs ?? 0) - (right.firstUsefulPaintMs ?? 0))[Math.floor(samples.length / 2)];
  const numeric = [
    "documentReadyMs",
    "catalogueReturnMs",
    "selectedDetailReturnMs",
    "firstUsefulPaintMs",
    "usefulDetectedMs",
    "threadDetectedMs",
    "coldThreadMs",
    "firstLivePaintP95Ms",
    "frameRate",
    "rawFrameRate",
    "frameCapacity",
    "p95FrameMs",
    "domSize",
    "idleCpuPercent",
    "hiddenCpuPercent",
    "delayFromLocalMs",
    "requestCount",
    "transferredBytes",
    "webSocketPayloadBytes",
    "maxWebSocketPayloadBytes",
    "longTaskCount",
    "longTaskDurationMs",
    "affectedRowRenders",
    "unrelatedRowRenders",
    "rawLivePaintP95Ms",
    "stableRowRenders",
    "composerShiftPx",
    "sendActionShiftPx",
    "scrollFollowDistancePx",
  ];
  const combined = { ...representative, runs: samples.length };
  for (const field of numeric) {
    const values = samples.map((sample) => sample[field]).filter(Number.isFinite);
    if (values.length > 0) combined[field] = percentile(values, 50);
  }
  if (samples.some((sample) => sample.neverPainted)) combined.neverPainted = true;
  combined.mutatingRequests = [...new Set(samples.flatMap((sample) => sample.mutatingRequests ?? []))];
  if (samples.some((sample) => sample.livePaintSamples)) {
    combined.livePaintSamples = samples.flatMap((sample) => sample.livePaintSamples ?? []);
    combined.rawLivePaintP95Ms = percentile(combined.livePaintSamples, 95);
    combined.firstLivePaintP95Ms = normalizeLatency(
      combined.rawLivePaintP95Ms,
      combined.frameCapacity ?? 60,
    );
  }
  return combined;
}

async function openHarnessPage(target, fixture, hash) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installPerformanceBridge, fixture);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${target.url}${hash}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  return { context, page, errors };
}

async function runThreadOpen(target, entryCount) {
  const fixture = createFixture({ threadCount: 25, entryCount });
  const opened = await openHarnessPage(target, fixture, `#/threads/${fixture.primaryThreadId}`);
  try {
    const observed = await observeUseful(opened.page, fixture.primaryTitle);
    // Recorded on both cold and warm opens so the one number this comparison
    // turns on — when the thread itself was readable — is directly comparable.
    const threadDetectedMs = await waitForText(opened.page, fixture.lastEntryText);
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "cold-open",
      entryCount,
      threadCount: 25,
      threadDetectedMs,
      ...observed,
    });
    if (entryCount === 500) {
      const history = await loadAllHistory(opened.page);
      const frames = await measureScroll(opened.page, "main");
      result.related = {
        target: target.name,
        scenario: "thread-scroll",
        entryCount,
        ...history,
        ...frames,
      };
    }
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function loadAllHistory(page) {
  const button = page.getByRole("button", { name: "Load earlier messages" });
  let pages = 0;
  let largestAnchorShiftPx = 0;
  while (await button.count()) {
    if (pages >= 50) throw new Error("History pagination did not reach the oldest turn.");
    await button.scrollIntoViewIfNeeded();
    const requestCount = await page.evaluate(() => window.__remyPerf.requests.length);
    await button.click();
    await page.waitForFunction(
      (count) => window.__remyPerf.requests.length > count,
      requestCount,
      { timeout: TIMEOUT_MS, polling: "raf" },
    );
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading earlier messages…"),
      undefined,
      { timeout: TIMEOUT_MS, polling: "raf" },
    );
    await nextPaint(page);
    const anchor = await page.locator("[data-virtual-transcript]").evaluate((transcript) => ({
      key: transcript.getAttribute("data-history-anchor"),
      viewportOffset: Number(transcript.getAttribute("data-history-anchor-viewport-offset")),
    }));
    if (anchor?.key) {
      const anchored = page.locator(`[data-virtual-turn="${anchor.key}"]`);
      try {
        await anchored.waitFor({ state: "attached", timeout: TIMEOUT_MS });
      } catch {
        const state = await page.evaluate(() => {
          const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
          const transcript = document.querySelector("[data-virtual-transcript]");
          return {
            scrollTop: viewport?.scrollTop,
            scrollHeight: viewport?.scrollHeight,
            viewportHeight: viewport?.clientHeight,
            transcriptTop: transcript?.offsetTop,
            transcriptHeight: transcript?.getBoundingClientRect().height,
            historyAnchor: transcript?.getAttribute("data-history-anchor"),
            historyAnchorApplied: transcript?.getAttribute("data-history-anchor-applied"),
            rows: [...document.querySelectorAll("[data-virtual-turn]")].map((row) => row.getAttribute("data-virtual-turn")),
          };
        });
        throw new Error(`History anchor ${anchor.key} was not mounted: ${JSON.stringify(state)}`);
      }
      const nextViewportOffset = await anchored.evaluate((row) => {
        const viewport = row.closest('[data-slot="scroll-area-viewport"]');
        return row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      });
      largestAnchorShiftPx = Math.max(
        largestAnchorShiftPx,
        Math.abs(nextViewportOffset - anchor.viewportOffset),
      );
    }
    pages += 1;
  }
  await page.waitForTimeout(1_100);
  return {
    historyPages: pages,
    largestAnchorShiftPx,
    renderedTurns: await page.locator("[data-virtual-turn]").count(),
  };
}

async function runSidebar(target, threadCount) {
  const fixture = createFixture({ threadCount, entryCount: 10 });
  const opened = await openHarnessPage(target, fixture, "#/threads");
  try {
    const observed = await observeUseful(opened.page, fixture.primaryTitle);
    const initialThreadRows = await opened.page.locator("[data-thread-id]").count();
    const reveal = opened.page.locator("[data-sidebar-show-more]").first();
    const initialHiddenThreads = await reveal.count()
      ? Number(await reveal.getAttribute("data-hidden-count"))
      : 0;
    const frames = threadCount === 250
      ? await measureScroll(opened.page, '[data-sidebar="sidebar"]')
      : {};
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "sidebar",
      threadCount,
      initialThreadRows,
      initialHiddenThreads,
      ...observed,
      ...frames,
    });
    if (threadCount === 250 && initialHiddenThreads > 0) {
      await reveal.click();
      await opened.page.waitForFunction(
        (count) => document.querySelectorAll("[data-thread-id]").length > count,
        initialThreadRows,
      );
      result.revealedThreadRows = await opened.page.locator("[data-thread-id]").count();
      result.remainingHiddenThreads = Number(await opened.page.locator("[data-sidebar-show-more]").first().getAttribute("data-hidden-count"));
    }
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function runSidebarBehavior(target) {
  const fixture = createFixture({ threadCount: 250, entryCount: 10 });
  const chats = fixture.responses["/chats"].chats;
  const child = chats.find((chat) => chat.id === "thread-200");
  const working = chats.find((chat) => chat.id === "thread-249");
  const needsInput = chats.find((chat) => chat.id === "thread-250");
  child.parentChatId = "thread-199";
  working.state = "working";
  needsInput.state = "needs_input";
  const childDetail = {
    ...fixture.responses[`/chats/${fixture.primaryThreadId}`],
    ...child,
  };
  fixture.responses[`/chats/${child.id}`] = childDetail;
  fixture.responses["/archives"] = {
    archives: Array.from({ length: 75 }, (_, index) => ({
      id: `archive-${index + 1}`,
      chatId: `archived-thread-${index + 1}`,
      session: `Archived performance thread ${index + 1}`,
      cwd: "/tmp/remy-performance",
      archivedAt: 1_600_000_000_000 - index,
      conversation: { title: `Archived performance thread ${index + 1}`, entries: [], todos: [] },
    })),
  };

  const opened = await openHarnessPage(target, fixture, "#/tasks");
  try {
    try {
      await waitForText(opened.page, fixture.primaryTitle);
    } catch (error) {
      const body = await opened.page.locator("body").innerText();
      throw new Error(`${error.message}\n${opened.errors.join("\n")}\n${body.slice(0, 2_000)}`);
    }
    const sidebarInTasks = await opened.page.locator(`[data-thread-id="${fixture.primaryThreadId}"]`).count() === 1;
    const activeRowsVisible = await opened.page.locator('[data-thread-id="thread-249"], [data-thread-id="thread-250"]').count() === 2;
    await opened.page.evaluate(() => {
      window.__remyPerf.resetMeasurements();
      window.__remyPerf.emit({ type: "chats" });
    });
    await opened.page.waitForFunction(() => window.__remyPerf.requests.some((request) => request.path === "/chats"));
    await nextPaint(opened.page);
    const catalogueStableRowRenders = await opened.page.evaluate(() =>
      window.__remyPerf.renders.filter((render) => render.surface === "thread-row").length);

    await opened.page.locator("header button:has(svg.lucide-search)").click();
    const search = opened.page.getByPlaceholder("Search threads and commands");
    await search.fill(child.title);
    const searchResult = opened.page.locator("[cmdk-item]").filter({ hasText: child.title });
    const hiddenSearchFound = await searchResult.count() === 1;
    await searchResult.click();
    await opened.page.waitForFunction((id) => window.location.hash.includes(id), child.id);
    const selectedGroupVisible = await opened.page.locator('[data-thread-id="thread-199"], [data-thread-id="thread-200"]').count() === 2;

    const archiveReveal = opened.page.locator("[data-sidebar-show-more]").last();
    const rowsBeforeReveal = await opened.page.locator("[data-thread-id]").count();
    await archiveReveal.focus();
    await archiveReveal.press("Enter");
    await opened.page.waitForFunction(
      (count) => document.querySelectorAll("[data-thread-id]").length > count,
      rowsBeforeReveal,
    );
    const keyboardRevealWorked = await opened.page.locator("[data-thread-id]").count() > rowsBeforeReveal;

    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "sidebar-behavior",
      threadCount: fixture.threadCount,
      sidebarInTasks,
      activeRowsVisible,
      catalogueStableRowRenders,
      hiddenSearchFound,
      selectedGroupVisible,
      keyboardRevealWorked,
    });
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function runThreadLifecycle(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 100 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installPerformanceBridge, fixture);
  const first = await context.newPage();
  await first.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await observeUseful(first, fixture.lastEntryText);
  // A window that is closed the instant it paints leaves nothing behind, so the
  // scenario would be measuring a cold open under a warm name. Give the first
  // window the moment it needs to record what it knew — and no more than a
  // moment, so a build with no warm cache at all still reports its real number
  // rather than hanging here.
  await waitForWarmCache(first);
  await first.close();

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  // A warm open is measured on the transcript rather than the sidebar row: the
  // thread itself is what a restart used to wait a whole waterfall for, and it
  // is what the warm cache is there to put on screen in the first frame.
  const warmObserved = await observeUseful(page, fixture.lastEntryText);
  const warm = await snapshotResult(page, {
    target: target.name,
    scenario: "warm-open",
    entryCount: 100,
    threadCount: 25,
    threadDetectedMs: warmObserved.usefulDetectedMs,
    ...warmObserved,
  });

  await setHashAndWait(page, "#/board", "Tasks");
  await page.evaluate(() => window.__remyPerf.resetMeasurements());
  const lifecycleFrameCapacity = await measureFrameCapacity(page);
  const cachedStarted = await page.evaluate(() => performance.now());
  await setHashAndWait(page, `#/threads/${fixture.primaryThreadId}`, fixture.lastEntryText);
  const cachedPainted = await nextPaint(page);
  const cached = await snapshotResult(page, {
    target: target.name,
    scenario: "cached-thread",
    entryCount: 100,
    firstUsefulPaintMs: cachedPainted - cachedStarted,
  });

  await page.evaluate(() => window.__remyPerf.resetMeasurements());
  const stableRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-virtual-turn]")];
    const row = rows.at(-2);
    const section = row?.querySelector("[data-transcript-render-count]");
    return row && section ? {
      key: row.getAttribute("data-virtual-turn"),
      renders: Number(section.getAttribute("data-transcript-render-count")),
    } : undefined;
  });
  const controlsBefore = await page.evaluate(() => {
    const composer = document.querySelector('[aria-label="Message"]')?.closest("form");
    const send = composer?.querySelector('[aria-label="Send"]')?.getBoundingClientRect();
    const model = composer?.querySelector('[data-model-picker]')?.textContent?.replace(/\s+/g, " ").trim();
    return {
      composerTop: composer?.getBoundingClientRect().top,
      send: send ? { x: send.x, y: send.y } : undefined,
      model,
    };
  });
  const livePaintSamples = [];
  for (let index = 0; index < LIVE_SAMPLES; index += 1) {
    const marker = `Live performance frame ${index + 1}`;
    livePaintSamples.push(await emitChatFrame(page, fixture.primaryThreadId, marker));
  }
  const stableRowRenders = stableRow?.key
    ? await page.locator(`[data-virtual-turn="${stableRow.key}"] [data-transcript-render-count]`).evaluate(
      (section, before) => Number(section.getAttribute("data-transcript-render-count")) - before,
      stableRow.renders,
    )
    : 0;
  const streamingLayout = await page.evaluate((before) => {
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
    const composer = document.querySelector('[aria-label="Message"]')?.closest("form");
    const send = composer?.querySelector('[aria-label="Send"]')?.getBoundingClientRect();
    const model = composer?.querySelector('[data-model-picker]')?.textContent?.replace(/\s+/g, " ").trim();
    return {
      composerShiftPx: composer && Number.isFinite(before.composerTop)
        ? Math.abs(composer.getBoundingClientRect().top - before.composerTop)
        : Number.POSITIVE_INFINITY,
      sendActionShiftPx: send && before.send
        ? Math.hypot(send.x - before.send.x, send.y - before.send.y)
        : Number.POSITIVE_INFINITY,
      modelSelectionStable: Boolean(model && before.model && model === before.model),
      scrollFollowDistancePx: viewport
        ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        : Number.POSITIVE_INFINITY,
    };
  }, controlsBefore);
  const live = await snapshotResult(page, {
    target: target.name,
    scenario: "live-update",
    entryCount: 100,
    firstLivePaintP95Ms: normalizeLatency(percentile(livePaintSamples, 95), lifecycleFrameCapacity),
    rawLivePaintP95Ms: percentile(livePaintSamples, 95),
    frameCapacity: lifecycleFrameCapacity,
    livePaintSamples,
    stableRowRenders,
    ...streamingLayout,
  });

  await page.evaluate(() => window.__remyPerf.resetMeasurements());
  await page.evaluate(() => window.__remyPerf.disconnect());
  await page.waitForTimeout(20);
  const reconnectMarker = "First frame after reconnect";
  await page.evaluate(() => window.__remyPerf.reconnect());
  const reconnectLatency = await emitChatFrame(page, fixture.primaryThreadId, reconnectMarker);
  const reconnect = await snapshotResult(page, {
    target: target.name,
    scenario: "reconnect",
    entryCount: 100,
    firstLivePaintP95Ms: normalizeLatency(reconnectLatency, lifecycleFrameCapacity),
    rawLivePaintP95Ms: reconnectLatency,
    frameCapacity: lifecycleFrameCapacity,
  });

  await page.evaluate((chatId) => {
    window.__remyPerf.emit({
      type: "chat",
      chatId,
      state: "idle",
      updatedAt: Date.now(),
    });
  }, fixture.primaryThreadId);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__remyPerf.resetMeasurements());
  const idle = await measureIdle(page, target.name);

  await page.reload({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  const deepLinkObserved = await observeUseful(page, fixture.primaryTitle);
  await waitForText(page, fixture.lastEntryText);
  const deepLink = await snapshotResult(page, {
    target: target.name,
    scenario: "deep-link-reload",
    entryCount: 100,
    ...deepLinkObserved,
  });
  assertPageErrors(errors, warm);
  await context.close();
  return [warm, cached, live, reconnect, idle, deepLink];
}

async function runUnavailableDevice(target) {
  const localFixture = createFixture({ threadCount: 25, entryCount: 100 });
  const local = await openHarnessPage(target, localFixture, `#/threads/${localFixture.primaryThreadId}`);
  let localUseful;
  try {
    localUseful = (await observeUseful(local.page, localFixture.primaryTitle)).firstUsefulPaintMs;
  } finally {
    await local.context.close();
  }

  const fixture = createFixture({ threadCount: 25, entryCount: 100, unavailableDevice: true });
  const opened = await openHarnessPage(target, fixture, `#/threads/${fixture.primaryThreadId}`);
  try {
    const observed = await observeUseful(opened.page, fixture.primaryTitle);
    await waitForText(opened.page, fixture.lastEntryText);
    await opened.page.waitForTimeout(1_250);
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "unavailable-device",
      entryCount: 100,
      threadCount: 25,
      unavailableDevice: true,
      ...observed,
      delayFromLocalMs: Math.max(0, observed.firstUsefulPaintMs - localUseful),
    });
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function runPaneRoutes(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 10 });
  const panes = [
    ["threads", "#/threads", fixture.primaryTitle],
    ["workspaces", "#/workspaces", "Performance workspace"],
    ["tasks", "#/board", "Tasks"],
    ["pull-requests", "#/pull-requests", "No pull requests"],
    ["devices", "#/settings/devices", "This machine"],
  ];
  const paneResults = [];
  for (const [name, hash, marker] of panes) {
    const opened = await openHarnessPage(target, fixture, hash);
    try {
      const observed = await observeUseful(opened.page, marker);
      const result = await snapshotResult(opened.page, {
        target: target.name,
        scenario: `pane-${name}`,
        ...observed,
      });
      assertPageErrors(opened.errors, result);
      paneResults.push(result);
    } finally {
      await opened.context.close();
    }
  }
  return paneResults;
}

/// Every work surface a thread leaves on the network until it opens: what the
/// first open costs, what the second one costs, and whether the pane moved
/// while the code was still arriving.
async function runDeferredSurfaces(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 10 });
  const opened = await openHarnessPage(target, fixture, `#/threads/${fixture.primaryThreadId}`);
  const surfaces = [];
  try {
    await waitForText(opened.page, fixture.lastEntryText);
    surfaces.push(await measureTerminal(target, opened.page, fixture));
    for (const tool of DEFERRED_TOOLS) {
      surfaces.push(await measureTool(target, opened.page, fixture, tool));
    }
    for (const surface of surfaces) assertPageErrors(opened.errors, surface);
    return surfaces;
  } finally {
    await opened.context.close();
  }
}

/// Opens a tool from the strip's menu. The menu is not part of the measurement.
function addTab(page, label) {
  return {
    prepare: () => page.getByRole("button", { name: "Add tab" }).first().click(),
    commit: () => page.getByRole("menuitem", { name: label, exact: true }).click(),
  };
}

async function measureTerminal(target, page, fixture) {
  const open = addTab(page, "Terminal");
  const firstOpen = await timeSurface(page, { ...open, ready: TERMINAL_READY });
  // The shell keeps running behind another tab, so bringing the transcript
  // forward must not take the renderer with it.
  await page.getByRole("tab", { name: fixture.primaryTitle }).click();
  const keptOnHide = await page.locator('section[aria-label="Terminal"]').count() > 0;
  const back = () => page.getByRole("tab", { name: "Terminal" }).click();
  const reopen = await timeSurface(page, { commit: back, ready: TERMINAL_READY });
  await page.getByRole("button", { name: "Close Terminal" }).first().click();
  return snapshotResult(page, {
    target: target.name,
    scenario: "surface-terminal",
    threadCount: fixture.threadCount,
    keptOnHide,
    // Opening a terminal starts one; the tab cannot be measured without it.
    allowedWrites: ["POST /terminals/"],
    ...surfaceTimings(firstOpen, reopen),
  });
}

async function measureTool(target, page, fixture, tool) {
  const { prepare, commit } = addTab(page, tool.label);
  const ready = toolReady(tool.label);

  const firstOpen = await timeSurface(page, { prepare, commit, ready });
  // Closing the tab and opening the same tool again. Its code is already in
  // memory, so this second open never waits on the network.
  await page.getByRole("button", { name: `Close ${tool.label}` }).first().click();
  const reopen = await timeSurface(page, { prepare, commit, ready });
  return snapshotResult(page, {
    target: target.name,
    scenario: `surface-${tool.id}`,
    threadCount: fixture.threadCount,
    // Closing a browser tab closes the browser behind it.
    allowedWrites: [`POST /chats/${fixture.primaryThreadId}/browser`],
    ...surfaceTimings(firstOpen, reopen),
  });
}

/// The pair of opens as one row: what each cost, whether the placeholder was
/// ever needed, and the worst the page moved across both.
function surfaceTimings(firstOpen, reopen) {
  return {
    firstOpenMs: firstOpen.firstOpenMs,
    loadingStateShown: firstOpen.loadingStateShown,
    reopenMs: reopen.firstOpenMs,
    reopenFromMemory: !reopen.loadingStateShown,
    layoutShift: Math.max(firstOpen.layoutShift, reopen.layoutShift),
  };
}

/// The tool's own tab is in front of its group and its own panel has drawn
/// something. Every tab keeps a panel mounted behind the front one, so the
/// panel has to be the one this tab points at rather than the first in the group.
function toolReady(label) {
  return `(() => {
    const selected = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .find((tab) => tab.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!selected) return false;
    const panel = document.getElementById(selected.getAttribute("aria-controls"));
    return Boolean(panel && getComputedStyle(panel).display !== "none" && panel.childElementCount > 0);
  })()`;
}

/// From the click that asks for a surface to the surface being on screen, timed
/// inside the page so the harness's own round trips stay out of the number.
///
/// `prepare` is whatever has to happen first — opening a menu — and is not
/// timed. `commit` is the click being measured.
async function timeSurface(page, { prepare, commit, ready }) {
  await page.evaluate(() => {
    window.__remyPerf.resetMeasurements();
    window.__remySurface = { clickedAt: undefined, loadingShown: false };
    window.__remySurfaceWatch?.disconnect();
    window.__remySurfaceWatch = new MutationObserver(() => {
      if (document.querySelector('[data-slot="surface-loading"]')) window.__remySurface.loadingShown = true;
    });
    window.__remySurfaceWatch.observe(document.body, { childList: true, subtree: true });
  });
  await prepare?.();
  // Armed after `prepare` so a menu opening is not mistaken for the click.
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      () => { window.__remySurface.clickedAt = performance.now(); },
      { capture: true, once: true },
    );
  });
  await commit();
  const settledAt = await page.waitForFunction(
    `(() => {
      if (window.__remySurface.clickedAt === undefined) return false;
      if (document.querySelector('[data-slot="surface-loading"]')) return false;
      return ${ready} ? performance.now() : false;
    })()`,
    undefined,
    { timeout: TIMEOUT_MS },
  ).then((handle) => handle.jsonValue());
  await nextPaint(page);
  const observed = await page.evaluate(() => {
    window.__remySurfaceWatch?.disconnect();
    return {
      clickedAt: window.__remySurface.clickedAt,
      loadingStateShown: window.__remySurface.loadingShown === true,
      layoutShift: window.__remyPerf.layoutShifts.reduce((total, shift) => total + shift.value, 0),
    };
  });
  return {
    firstOpenMs: settledAt - observed.clickedAt,
    loadingStateShown: observed.loadingStateShown,
    layoutShift: observed.layoutShift,
  };
}

async function runSharedReadFailure(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 10 });
  const opened = await openHarnessPage(target, fixture, "#/board");
  try {
    await waitForText(opened.page, "Performance workspace");
    await opened.page.evaluate(() => {
      window.__remyPerf.resetMeasurements();
      window.__remyPerf.failNext("/board");
      window.__remyPerf.emit({ type: "board" });
    });
    await opened.page.waitForFunction(() =>
      window.__remyPerf.requests.some((request) => request.path === "/board" && request.ok === false));
    const usefulPreserved = await opened.page.evaluate(() =>
      document.body?.innerText.includes("Performance workspace") === true);
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "shared-read-failure",
      usefulPreserved,
    });
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

async function runCatalogueGap(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 100 });
  const opened = await openHarnessPage(target, fixture, `#/threads/${fixture.primaryThreadId}`);
  try {
    await waitForText(opened.page, fixture.lastEntryText);
    await opened.page.evaluate(() => {
      window.__remyPerf.resetMeasurements();
      window.__remyPerf.hideCatalogue();
      window.__remyPerf.emit({ type: "chats" });
    });
    await opened.page.waitForFunction(() =>
      window.__remyPerf.requests.some((request) => request.path === "electron://servers"));
    await nextPaint(opened.page);
    const state = await opened.page.evaluate((marker) => ({
      usefulPreserved: document.body?.innerText.includes(marker) === true,
      loadingReplacementShown: Boolean(
        document.querySelector('[data-slot="surface-loading"]')
        || document.querySelector('[data-slot="skeleton"]'),
      ),
    }), fixture.lastEntryText);
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "catalogue-gap",
      ...state,
    });
    assertPageErrors(opened.errors, result);
    return result;
  } finally {
    await opened.context.close();
  }
}

/// How much of a warm reopen the cache actually pays for, against a device that
/// takes a moment to answer.
///
/// The default fixture answers in four milliseconds, where a warm reopen has
/// almost nothing to skip: the whole cost is rendering, and both sides of the
/// comparison pay it. A real daemon reads SQLite over IPC and a paired machine
/// is on the other side of a tailnet, so this asks the same code the question a
/// person's machine asks it. Cold and warm are measured back to back in one
/// context so they share whatever else the machine is doing.
async function runWarmLatency(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 100, readDelayMs: WARM_LATENCY_MS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installPerformanceBridge, fixture);

  const first = await context.newPage();
  const errors = [];
  first.on("pageerror", (error) => errors.push(error.message));
  await first.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  const coldThreadMs = await waitForText(first, fixture.lastEntryText);
  const openedWarm = await waitForWarmCache(first);
  await first.close();

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  const observed = await observeUseful(page, fixture.lastEntryText);
  // What the cache removes is request wait; what both sides pay is rendering.
  // On a machine slow enough that rendering swamps the wait, the comparison
  // stops meaning anything, so record how fast this machine actually is and let
  // the budget decide whether to hold the result to account.
  const frameCapacity = await measureFrameCapacity(page);
  const result = await snapshotResult(page, {
    target: target.name,
    scenario: "warm-latency",
    entryCount: 100,
    threadCount: 25,
    readDelayMs: WARM_LATENCY_MS,
    openedWarm,
    frameCapacity,
    coldThreadMs,
    threadDetectedMs: observed.usefulDetectedMs,
    ...observed,
  });
  assertPageErrors(errors, result);
  await context.close();
  return result;
}

/// A warm reopen of a machine that has gone to sleep, and the reconnect after
/// it. Every assertion here is a yes or a no rather than a duration, so it says
/// the same thing on a busy machine as on an idle one.
async function runWarmOffline(target) {
  const fixture = createFixture({ threadCount: 25, entryCount: 100 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installPerformanceBridge, fixture);

  const first = await context.newPage();
  await first.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await observeUseful(first, fixture.lastEntryText);
  const openedWarm = await waitForWarmCache(first);
  await first.close();

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(() => window.__remyPerf.unreachable());
  await page.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });

  // Nothing this window shows can have come from the device: every read it
  // makes fails. What is on screen is what it knew, and it is on screen without
  // waiting for the failures to come back.
  const offlineObserved = await observeUseful(page, fixture.lastEntryText);
  const sidebarPreserved = await page.evaluate(
    (title) => document.body?.innerText.includes(title) === true,
    fixture.primaryTitle,
  );
  await page.waitForFunction(
    () => window.__remyPerf.requests.some((request) => request.path === "/chats" && request.ok === false),
    undefined,
    { timeout: TIMEOUT_MS },
  );
  const readsAttempted = await page.evaluate(() => {
    const failed = window.__remyPerf.requests.filter((request) => request.ok === false).map((request) => request.path);
    return {
      catalogue: failed.includes("/chats"),
      transcript: failed.some((path) => /^\/chats\/[^/]+/.test(path)),
    };
  });

  // Then the machine wakes up. The same entries come back in the fresh read, so
  // this is where a warm transcript would duplicate itself if merging were
  // wrong, and where a row would keep a status nobody corrected.
  await page.evaluate(() => {
    window.__remyPerf.reachable();
    window.__remyPerf.emit({ type: "chats" });
  });
  await page.waitForFunction(
    () => window.__remyPerf.requests.some((request) => request.path === "/chats" && request.ok === true),
    undefined,
    { timeout: TIMEOUT_MS },
  );
  await page.waitForTimeout(300);
  const converged = await page.evaluate((marker) => {
    const turns = [...document.querySelectorAll("[data-virtual-turn]")].map((row) =>
      row.getAttribute("data-virtual-turn"));
    const text = document.body?.innerText ?? "";
    let occurrences = 0;
    let at = text.indexOf(marker);
    while (at >= 0) {
      occurrences += 1;
      at = text.indexOf(marker, at + marker.length);
    }
    return { turns: turns.length, unique: new Set(turns).size, occurrences };
  }, fixture.lastEntryText);

  const result = await snapshotResult(page, {
    target: target.name,
    scenario: "warm-offline",
    entryCount: 100,
    threadCount: 25,
    openedWarm,
    ...offlineObserved,
    usefulPreserved: offlineObserved.neverPainted !== true && sidebarPreserved,
    readsAttempted: readsAttempted.catalogue && readsAttempted.transcript,
    duplicatedEntries: converged.turns - converged.unique + Math.max(0, converged.occurrences - 1),
  });
  assertPageErrors(errors, result);
  await context.close();
  return result;
}

/// Whether the window left a snapshot behind, which is the difference between
/// "the warm cache did not work" and "there was no warm cache to work". A build
/// without one, or a machine too busy to have settled yet, is reported as such
/// rather than as content this scenario lost.
async function waitForWarmCache(page) {
  try {
    await page.waitForFunction(
      () => Object.keys(localStorage).some((key) => key.startsWith("remy.warm-cache")),
      undefined,
      { timeout: TIMEOUT_MS, polling: 100 },
    );
    return true;
  } catch {
    return false;
  }
}

async function observeUseful(page, marker) {
  try {
    const usefulDetectedMs = await waitForText(page, marker);
    const firstUsefulPaintMs = await nextPaint(page);
    return { firstUsefulPaintMs, usefulDetectedMs, neverPainted: false };
  } catch {
    return { firstUsefulPaintMs: TIMEOUT_MS, usefulDetectedMs: TIMEOUT_MS, neverPainted: true };
  }
}

/// When the page itself first had the text, not when this process could ask.
/// `firstUsefulPaintMs` is deliberately two frames later, because a budget
/// should include the frame that actually shows it; anything comparing a paint
/// against a request timestamp wants this one instead.
async function waitForText(page, marker) {
  const detected = await page.waitForFunction(
    (text) => (document.body?.innerText.includes(text) ? performance.now() : false),
    marker,
    { timeout: TIMEOUT_MS, polling: "raf" },
  );
  return detected.jsonValue();
}

async function setHashAndWait(page, hash, marker) {
  await page.evaluate((next) => { window.location.hash = next; }, hash);
  await waitForText(page, marker);
}

async function nextPaint(page) {
  return page.evaluate(() => new Promise((resolvePaint) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint(performance.now())));
  }));
}

async function measureFrameCapacity(page) {
  return page.evaluate(() => new Promise((resolveCapacity) => {
    const times = [];
    let previous;
    const started = performance.now();
    const frame = (now) => {
      if (previous !== undefined) times.push(now - previous);
      previous = now;
      if (now - started < 500) requestAnimationFrame(frame);
      else {
        const elapsed = times.reduce((total, time) => total + time, 0);
        resolveCapacity(elapsed > 0 ? (times.length * 1_000) / elapsed : 60);
      }
    };
    requestAnimationFrame(frame);
  }));
}

function normalizeLatency(milliseconds, frameCapacity) {
  return frameCapacity > 0 && frameCapacity < 60
    ? milliseconds * (frameCapacity / 60)
    : milliseconds;
}

async function emitChatFrame(page, chatId, text) {
  return page.evaluate(({ id, marker }) => new Promise((resolvePaint, rejectPaint) => {
    const started = performance.now();
    const timeout = setTimeout(() => {
      observer.disconnect();
      rejectPaint(new Error(`Live content did not paint: ${marker}`));
    }, 10_000);
    const observer = new MutationObserver(() => {
      if (!document.body?.innerText.includes(marker)) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolvePaint(performance.now() - started);
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.__remyPerf.emit({
      type: "chat",
      chatId: id,
      entries: [{ id: "live-entry", kind: "assistant", text: marker, at: Date.now() }],
      state: "working",
      updatedAt: Date.now(),
    });
  }), { id: chatId, marker: text });
}

async function snapshotResult(page, base) {
  await page.waitForTimeout(25);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const requests = window.__remyPerf.requests.slice();
    const resources = performance.getEntriesByType("resource");
    const catalogue = requests.filter((request) => request.path === "/chats").at(-1);
    const detail = requests.filter((request) => /^\/chats\/[^/?]+(?:\?.*)?$/.test(request.path)).at(-1);
    const longTasks = window.__remyPerf.longTasks.slice();
    return {
      documentReadyMs: navigation?.domContentLoadedEventEnd ?? 0,
      catalogueReturnMs: catalogue?.end,
      selectedDetailReturnMs: detail?.end,
      domSize: document.getElementsByTagName("*").length,
      longTaskCount: longTasks.length,
      longTaskDurationMs: longTasks.reduce((total, task) => total + task.duration, 0),
      resourceBytes: resources.reduce(
        (total, resource) => total + (resource.transferSize || resource.encodedBodySize || 0),
        0,
      ),
      requests,
      livePayloadBytes: window.__remyPerf.livePayloadBytes.slice(),
    };
  });
  const requestBytes = metrics.requests.reduce((total, request) => total + request.bytes, 0);
  const mutatingRequests = metrics.requests
    .filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method))
    .map((request) => `${request.method} ${request.path}`);
  return {
    ...base,
    documentReadyMs: metrics.documentReadyMs,
    catalogueReturnMs: metrics.catalogueReturnMs,
    selectedDetailReturnMs: metrics.selectedDetailReturnMs,
    domSize: metrics.domSize,
    longTaskCount: metrics.longTaskCount,
    longTaskDurationMs: metrics.longTaskDurationMs,
    requestCount: metrics.requests.length,
    transferredBytes: requestBytes + metrics.resourceBytes,
    webSocketPayloadBytes: metrics.livePayloadBytes.reduce((total, bytes) => total + bytes, 0),
    maxWebSocketPayloadBytes: Math.max(0, ...metrics.livePayloadBytes),
    requests: groupRequests(metrics.requests),
    mutatingRequests,
  };
}

async function measureScroll(page, rootSelector) {
  return page.evaluate(async (root) => {
    const scope = document.querySelector(root) ?? document.body;
    const scrollables = [scope, ...scope.querySelectorAll("*")]
      .filter((element) => element.scrollHeight - element.clientHeight > 40)
      .sort((left, right) =>
        (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    const scroller = scrollables[0];
    if (!scroller) return { frameRate: 0, p95FrameMs: 1_000, scrollable: false };
    const capacityTimes = [];
    let capacityPrevious;
    const capacityStarted = performance.now();
    await new Promise((resolveCapacity) => {
      const frame = (now) => {
        if (capacityPrevious !== undefined) capacityTimes.push(now - capacityPrevious);
        capacityPrevious = now;
        if (now - capacityStarted < 500) requestAnimationFrame(frame);
        else resolveCapacity();
      };
      requestAnimationFrame(frame);
    });
    const capacityElapsed = capacityTimes.reduce((total, frame) => total + frame, 0);
    const frameCapacity = capacityElapsed > 0 ? (capacityTimes.length * 1_000) / capacityElapsed : 0;
    const duration = 1_000;
    const frameTimes = [];
    let previous;
    const started = performance.now();
    await new Promise((resolveScroll) => {
      const frame = (now) => {
        if (previous !== undefined) frameTimes.push(now - previous);
        previous = now;
        const progress = Math.min(1, (now - started) / duration);
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * progress;
        if (progress < 1) requestAnimationFrame(frame);
        else resolveScroll();
      };
      requestAnimationFrame(frame);
    });
    const elapsed = frameTimes.reduce((total, frame) => total + frame, 0);
    const ordered = [...frameTimes].sort((left, right) => left - right);
    const p95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 1_000;
    const rawFrameRate = elapsed > 0 ? (frameTimes.length * 1_000) / elapsed : 0;
    return {
      frameRate: frameCapacity > 0 ? Math.min(60, (rawFrameRate / frameCapacity) * 60) : 0,
      rawFrameRate,
      frameCapacity,
      p95FrameMs: p95,
      scrollable: true,
    };
  }, rootSelector);
}

async function measureIdle(page, target) {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const visible = await cpuWindow(session, page, 1_500);
  const cover = await page.context().newPage();
  await cover.goto("about:blank");
  await cover.bringToFront();
  const hidden = await cpuWindow(session, page, 1_500);
  await cover.close();
  await page.bringToFront();
  await session.detach();
  return snapshotResult(page, {
    target,
    scenario: "idle",
    idleCpuPercent: visible.cpuPercent,
    hiddenCpuPercent: hidden.cpuPercent,
    visibilityState: hidden.visibilityState,
  });
}

async function cpuWindow(session, page, durationMs) {
  const before = metricMap(await session.send("Performance.getMetrics"));
  await page.waitForTimeout(durationMs);
  const after = metricMap(await session.send("Performance.getMetrics"));
  const taskSeconds = (after.TaskDuration ?? 0) - (before.TaskDuration ?? 0);
  return {
    cpuPercent: (taskSeconds / (durationMs / 1_000)) * 100,
    visibilityState: await page.evaluate(() => document.visibilityState),
  };
}

function metricMap(answer) {
  return Object.fromEntries(answer.metrics.map((metric) => [metric.name, metric.value]));
}

function assertPageErrors(errors, result) {
  if (errors.length > 0) {
    result.pageErrors = errors;
  }
}

function printResults(allResults) {
  const expanded = allResults.flatMap((result) => result.related ? [result, result.related] : [result]);
  console.log("\nPerformance results");
  for (const result of expanded) {
    const dataset = [
      result.entryCount ? `${result.entryCount} entries` : "",
      result.threadCount ? `${result.threadCount} threads` : "",
    ].filter(Boolean).join(", ");
    const measures = [
      Number.isFinite(result.documentReadyMs) ? `ready ${formatMs(result.documentReadyMs)}` : "",
      Number.isFinite(result.catalogueReturnMs) ? `catalogue ${formatMs(result.catalogueReturnMs)}` : "",
      Number.isFinite(result.selectedDetailReturnMs) ? `detail ${formatMs(result.selectedDetailReturnMs)}` : "",
      Number.isFinite(result.firstUsefulPaintMs) ? `useful ${formatMs(result.firstUsefulPaintMs)}` : "",
      Number.isFinite(result.usefulDetectedMs) ? `on screen ${formatMs(result.usefulDetectedMs)}` : "",
      Number.isFinite(result.threadDetectedMs) ? `thread readable ${formatMs(result.threadDetectedMs)}` : "",
      Number.isFinite(result.coldThreadMs) ? `cold ${formatMs(result.coldThreadMs)}` : "",
      Number.isFinite(result.readDelayMs) ? `device answers in ${result.readDelayMs}ms` : "",
      Number.isFinite(result.firstLivePaintP95Ms) ? `live p95 ${formatMs(result.firstLivePaintP95Ms)}` : "",
      Number.isFinite(result.rawLivePaintP95Ms) && Number.isFinite(result.frameCapacity)
        ? `${formatMs(result.rawLivePaintP95Ms)} raw @ ${result.frameCapacity.toFixed(1)} fps capacity`
        : "",
      Number.isFinite(result.frameRate) ? `${result.frameRate.toFixed(1)} fps` : "",
      Number.isFinite(result.rawFrameRate) && Number.isFinite(result.frameCapacity)
        ? `${result.rawFrameRate.toFixed(1)}/${result.frameCapacity.toFixed(1)} raw/capacity fps`
        : "",
      Number.isFinite(result.renderedTurns) ? `${result.renderedTurns} mounted turns` : "",
      Number.isFinite(result.initialThreadRows) ? `${result.initialThreadRows} mounted thread rows` : "",
      Number.isFinite(result.initialHiddenThreads) ? `${result.initialHiddenThreads} settled threads hidden` : "",
      Number.isFinite(result.revealedThreadRows) ? `${result.revealedThreadRows} rows after reveal` : "",
      Number.isFinite(result.catalogueStableRowRenders) ? `${result.catalogueStableRowRenders} catalogue rerenders` : "",
      Number.isFinite(result.largestAnchorShiftPx) ? `${result.largestAnchorShiftPx.toFixed(1)}px history shift` : "",
      Number.isFinite(result.stableRowRenders) ? `${result.stableRowRenders} stable rerenders` : "",
      Number.isFinite(result.composerShiftPx) ? `${result.composerShiftPx.toFixed(1)}px composer shift` : "",
      Number.isFinite(result.sendActionShiftPx) ? `${result.sendActionShiftPx.toFixed(1)}px send shift` : "",
      result.modelSelectionStable === undefined ? "" : `model ${result.modelSelectionStable ? "stable" : "changed"}`,
      Number.isFinite(result.scrollFollowDistancePx) ? `${result.scrollFollowDistancePx.toFixed(1)}px from newest` : "",
      Number.isFinite(result.idleCpuPercent) ? `idle ${result.idleCpuPercent.toFixed(2)}% CPU` : "",
      Number.isFinite(result.hiddenCpuPercent) ? `hidden ${result.hiddenCpuPercent.toFixed(2)}% CPU` : "",
      Number.isFinite(result.firstOpenMs) ? `first open ${formatMs(result.firstOpenMs)}` : "",
      Number.isFinite(result.reopenMs) ? `reopen ${formatMs(result.reopenMs)}` : "",
      Number.isFinite(result.layoutShift) ? `${result.layoutShift.toFixed(3)} layout shift` : "",
      result.loadingStateShown === undefined ? "" : `loading state ${result.loadingStateShown ? "shown" : "not needed"}`,
      result.reopenFromMemory === undefined ? "" : `reopened ${result.reopenFromMemory ? "from memory" : "over the network"}`,
      result.keptOnHide === undefined ? "" : `hidden pane ${result.keptOnHide ? "kept" : "discarded"}`,
      Number.isFinite(result.domSize) ? `${result.domSize} DOM nodes` : "",
      Number.isFinite(result.requestCount) ? `${result.requestCount} requests` : "",
      Number.isFinite(result.transferredBytes) ? `${formatBytes(result.transferredBytes)} transferred` : "",
      Number.isFinite(result.webSocketPayloadBytes) ? `${formatBytes(result.webSocketPayloadBytes)} WebSocket` : "",
      Number.isFinite(result.longTaskCount) ? `${result.longTaskCount} long tasks` : "",
      Number.isFinite(result.affectedRowRenders) ? `${result.affectedRowRenders} affected row renders` : "",
      Number.isFinite(result.unrelatedRowRenders) ? `${result.unrelatedRowRenders} unrelated row renders` : "",
      result.openedWarm === undefined ? "" : `snapshot ${result.openedWarm ? "written" : "absent"}`,
      result.usefulPreserved === undefined ? "" : `known content ${result.usefulPreserved ? "kept" : "lost"}`,
      result.loadingReplacementShown === undefined ? "" : `loading replacement ${result.loadingReplacementShown ? "shown" : "avoided"}`,
      result.readsAttempted === undefined ? "" : `fresh reads ${result.readsAttempted ? "attempted" : "skipped"}`,
      Number.isFinite(result.duplicatedEntries) ? `${result.duplicatedEntries} duplicated entries` : "",
      result.hiddenSearchFound === undefined ? "" : `hidden search ${result.hiddenSearchFound ? "found" : "missing"}`,
      result.selectedGroupVisible === undefined ? "" : `selected hierarchy ${result.selectedGroupVisible ? "visible" : "hidden"}`,
      result.keyboardRevealWorked === undefined ? "" : `keyboard reveal ${result.keyboardRevealWorked ? "worked" : "failed"}`,
    ].filter(Boolean).join(" · ");
    console.log(`\n${result.target.padEnd(9)} ${result.scenario}${dataset ? ` (${dataset})` : ""}`);
    console.log(`  ${measures}`);
    if (result.requests) {
      for (const request of result.requests) {
        console.log(
          `  ${request.method.padEnd(4)} ${request.path} ×${request.count}`
          + ` · ${formatMs(request.durationMs)} · ${formatBytes(request.bytes)}`,
        );
      }
    }
    for (const error of result.pageErrors ?? []) console.log(`  page error: ${error}`);
  }
  console.log("\nBudgets");
  console.log(
    `  warm ≤${PERFORMANCE_BUDGETS.warmUsefulMs}ms · cold ≤${PERFORMANCE_BUDGETS.coldUsefulMs}ms`
    + ` · cached thread ≤${PERFORMANCE_BUDGETS.cachedThreadMs}ms`
    + ` · live p95 ≤${PERFORMANCE_BUDGETS.livePaintP95Ms}ms`,
  );
  console.log(
    `  large-list frame rate ≥${PERFORMANCE_BUDGETS.minimumFrameRate}fps`
    + ` · idle CPU ≤${PERFORMANCE_BUDGETS.idleCpuPercent}%`
    + ` · unavailable-device delay ≤${PERFORMANCE_BUDGETS.unavailableDelayMs}ms`,
  );
  console.log(
    `  surface first open ≤${PERFORMANCE_BUDGETS.surfaceFirstOpenMs}ms`
    + ` · surface reopen ≤${PERFORMANCE_BUDGETS.surfaceReopenMs}ms`
    + ` · surface layout shift ≤${PERFORMANCE_BUDGETS.maxSurfaceLayoutShift}`,
  );
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatBytes(value) {
  if (value < 1_024) return `${Math.round(value)}B`;
  return `${(value / 1_024).toFixed(1)}KB`;
}
