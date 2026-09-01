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

const targets = performanceTargets();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--allow-file-access-from-files"],
});
const results = [];

try {
  for (const target of targets) {
    console.log(`\n${target.name} — ${target.url}`);
    if (ONLY_SCENARIO !== "lifecycle") {
      for (const entryCount of ENTRY_COUNTS) {
        results.push(await repeated(() => runThreadOpen(target, entryCount)));
      }
    }
    if (ONLY_SCENARIO === "thread") continue;
    if (ONLY_SCENARIO === "lifecycle") {
      results.push(...await repeatedGroup(() => runThreadLifecycle(target)));
      continue;
    }
    for (const threadCount of [25, 250]) {
      results.push(await repeated(() => runSidebar(target, threadCount)));
    }
    results.push(...await repeatedGroup(() => runThreadLifecycle(target)));
    results.push(await repeated(() => runUnavailableDevice(target)));
    results.push(...await runPaneRoutes(target));
    results.push(await runSharedReadFailure(target));
  }
} finally {
  await browser.close();
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
    "longTaskCount",
    "longTaskDurationMs",
    "rawLivePaintP95Ms",
    "stableRowRenders",
    "composerShiftPx",
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
    await waitForText(opened.page, fixture.lastEntryText);
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "cold-open",
      entryCount,
      threadCount: 25,
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
    const observed = await observeUseful(opened.page, `Performance thread ${threadCount}`);
    const frames = threadCount === 250
      ? await measureScroll(opened.page, '[data-sidebar="sidebar"]')
      : {};
    const result = await snapshotResult(opened.page, {
      target: target.name,
      scenario: "sidebar",
      threadCount,
      ...observed,
      ...frames,
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
  await first.close();

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  const warmObserved = await observeUseful(page, fixture.primaryTitle);
  await waitForText(page, fixture.lastEntryText);
  const warm = await snapshotResult(page, {
    target: target.name,
    scenario: "warm-open",
    entryCount: 100,
    threadCount: 25,
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
  const composerTop = await page.locator('[aria-label="Message"]').evaluate((control) => control.closest("form").getBoundingClientRect().top);
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
  const streamingLayout = await page.evaluate((beforeComposerTop) => {
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
    const composer = document.querySelector('[aria-label="Message"]')?.closest("form");
    return {
      composerShiftPx: composer ? Math.abs(composer.getBoundingClientRect().top - beforeComposerTop) : Number.POSITIVE_INFINITY,
      scrollFollowDistancePx: viewport
        ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        : Number.POSITIVE_INFINITY,
    };
  }, composerTop);
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

async function observeUseful(page, marker) {
  try {
    await waitForText(page, marker);
    const firstUsefulPaintMs = await nextPaint(page);
    return { firstUsefulPaintMs, neverPainted: false };
  } catch {
    return { firstUsefulPaintMs: TIMEOUT_MS, neverPainted: true };
  }
}

async function waitForText(page, marker) {
  await page.waitForFunction(
    (text) => document.body?.innerText.includes(text),
    marker,
    { timeout: TIMEOUT_MS, polling: "raf" },
  );
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
      Number.isFinite(result.firstLivePaintP95Ms) ? `live p95 ${formatMs(result.firstLivePaintP95Ms)}` : "",
      Number.isFinite(result.rawLivePaintP95Ms) && Number.isFinite(result.frameCapacity)
        ? `${formatMs(result.rawLivePaintP95Ms)} raw @ ${result.frameCapacity.toFixed(1)} fps capacity`
        : "",
      Number.isFinite(result.frameRate) ? `${result.frameRate.toFixed(1)} fps` : "",
      Number.isFinite(result.rawFrameRate) && Number.isFinite(result.frameCapacity)
        ? `${result.rawFrameRate.toFixed(1)}/${result.frameCapacity.toFixed(1)} raw/capacity fps`
        : "",
      Number.isFinite(result.renderedTurns) ? `${result.renderedTurns} mounted turns` : "",
      Number.isFinite(result.largestAnchorShiftPx) ? `${result.largestAnchorShiftPx.toFixed(1)}px history shift` : "",
      Number.isFinite(result.stableRowRenders) ? `${result.stableRowRenders} stable rerenders` : "",
      Number.isFinite(result.composerShiftPx) ? `${result.composerShiftPx.toFixed(1)}px composer shift` : "",
      Number.isFinite(result.scrollFollowDistancePx) ? `${result.scrollFollowDistancePx.toFixed(1)}px from newest` : "",
      Number.isFinite(result.idleCpuPercent) ? `idle ${result.idleCpuPercent.toFixed(2)}% CPU` : "",
      Number.isFinite(result.hiddenCpuPercent) ? `hidden ${result.hiddenCpuPercent.toFixed(2)}% CPU` : "",
      Number.isFinite(result.domSize) ? `${result.domSize} DOM nodes` : "",
      Number.isFinite(result.requestCount) ? `${result.requestCount} requests` : "",
      Number.isFinite(result.transferredBytes) ? `${formatBytes(result.transferredBytes)} transferred` : "",
      Number.isFinite(result.longTaskCount) ? `${result.longTaskCount} long tasks` : "",
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
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function formatBytes(value) {
  if (value < 1_024) return `${Math.round(value)}B`;
  return `${(value / 1_024).toFixed(1)}KB`;
}
