import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { chromiumPath } from "./chromium.mjs";
import { createFixture, installPerformanceBridge, percentile } from "./perf-fixture.mjs";
import {
  TERMINAL_FIXTURES,
  TERMINAL_PERFORMANCE_BUDGETS,
  terminalBudgetFailures,
  terminalOutput,
} from "./terminal-perf-fixture.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = positiveInteger(process.env.MC_RUNS, 3);
const TIMEOUT_MS = positiveInteger(process.env.MC_PERF_TIMEOUT_MS, 15_000);
const OUTPUT_INTERVAL_MS = positiveInteger(process.env.MC_TERMINAL_OUTPUT_INTERVAL_MS, 16);
const INPUT_SAMPLES = positiveInteger(process.env.MC_TERMINAL_INPUT_SAMPLES, 12);
const terminalId = "thread-thread-1";
const targets = performanceTargets();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--allow-file-access-from-files"],
});
const results = [];

try {
  for (const target of targets) {
    console.log(`\n${target.name} — ${target.url}`);
    results.push(await repeated(() => runSmallOutput(target)));
    results.push(await repeated(() => runContinuousOutput(target)));
    results.push(await repeated(() => runLargeScrollback(target)));
  }
} finally {
  await browser.close();
}

const comparisons = compareCandidates(results, targets[0].name);
printResults(results, comparisons);
const report = {
  generatedAt: new Date().toISOString(),
  renderer: "@xterm/xterm 6",
  runs: RUNS,
  fixtures: TERMINAL_FIXTURES,
  budgets: TERMINAL_PERFORMANCE_BUDGETS,
  targets: targets.map(({ name, role, url }) => ({ name, role, url })),
  results,
  comparisons,
};
if (process.env.MC_TERMINAL_PERF_OUTPUT) {
  const output = resolve(process.env.MC_TERMINAL_PERF_OUTPUT);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${output}`);
}

const failures = results
  .filter((result) => result.target === targets[0].name)
  .flatMap((result) => terminalBudgetFailures(result).map((failure) => `${result.scenario}: ${failure}`));
if (failures.length > 0) {
  console.error("\nCURRENT RENDERER MISSES AN AGREED BUDGET");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nOK: the current renderer passes every applicable REMY-29 budget.");
}

async function runSmallOutput(target) {
  const output = terminalOutput(TERMINAL_FIXTURES.small, "Small");
  const marker = terminalMarker(output);
  const opened = await openHarnessPage(target, output);
  try {
    const session = await cdpSession(opened.page);
    const capacity = await measureFrameCapacity(opened.page);
    await resetMeasurements(opened.page);
    const before = await metricSnapshot(session);
    await startFrameProbe(opened.page);
    const firstPaintMs = await openTerminal(opened.page, marker);
    const frames = await stopFrameProbe(opened.page, capacity);
    const after = await metricSnapshot(session);
    const input = await measureInputLatency(opened.page);
    await session.detach();
    return withErrors(opened.errors, {
      target: target.name,
      scenario: "small-output",
      fixtureLines: TERMINAL_FIXTURES.small.lines,
      fixtureBytes: byteLength(output),
      firstPaintMs,
      inputLatencyP50Ms: percentile(input, 50),
      inputLatencyP95Ms: percentile(input, 95),
      inputSamples: input,
      ...frameFields(frames),
      ...metricFields(before, after, Math.max(firstPaintMs, 1)),
    });
  } finally {
    await opened.context.close();
  }
}

async function runContinuousOutput(target) {
  const initial = terminalOutput(TERMINAL_FIXTURES.small, "Continuous warmup");
  const opened = await openHarnessPage(target, initial);
  try {
    await openTerminal(opened.page, terminalMarker(initial));
    const session = await cdpSession(opened.page);
    const capacity = await measureFrameCapacity(opened.page);
    await resetMeasurements(opened.page);
    const before = await metricSnapshot(session);
    await startFrameProbe(opened.page);
    const output = await emitContinuousOutput(opened.page);
    const frames = await stopFrameProbe(opened.page, capacity);
    const after = await metricSnapshot(session);
    await session.detach();
    return withErrors(opened.errors, {
      target: target.name,
      scenario: "continuous-output",
      fixtureFrames: TERMINAL_FIXTURES.continuous.frames,
      fixtureLines: TERMINAL_FIXTURES.continuous.frames * TERMINAL_FIXTURES.continuous.linesPerFrame,
      fixtureBytes: output.bytes,
      outputDurationMs: output.durationMs,
      outputPaintP50Ms: percentile(output.paintSamples, 50),
      outputPaintP95Ms: percentile(output.paintSamples, 95),
      outputPaintSamples: output.paintSamples.length,
      missingPaintSamples: output.missingPaintSamples,
      ...frameFields(frames),
      ...metricFields(before, after, output.durationMs),
    });
  } finally {
    await opened.context.close();
  }
}

async function runLargeScrollback(target) {
  const output = terminalOutput(TERMINAL_FIXTURES.large, "Large");
  const marker = terminalMarker(output);
  const opened = await openHarnessPage(target, output);
  try {
    const session = await cdpSession(opened.page);
    const capacity = await measureFrameCapacity(opened.page);
    await resetMeasurements(opened.page);
    const before = await metricSnapshot(session);
    await startFrameProbe(opened.page);
    const firstPaintMs = await openTerminal(opened.page, marker);
    const openFrames = await stopFrameProbe(opened.page, capacity);
    const afterOpen = await metricSnapshot(session);

    const scroll = await measureTerminalScroll(opened.page, capacity);
    const resizeMs = await measureResize(opened.page);
    const selectionMs = await measureSelection(opened.page);
    const hidden = await measureHiddenOutput(opened.page, session);
    const hiddenMarker = hidden.marker;
    const beforeReopen = await metricSnapshot(session);
    await startFrameProbe(opened.page);
    const reopenMs = await reopenTerminal(opened.page, hiddenMarker);
    const reopenFrames = await stopFrameProbe(opened.page, capacity);
    const afterReopen = await metricSnapshot(session);
    await session.detach();

    return withErrors(opened.errors, {
      target: target.name,
      scenario: "large-scrollback",
      fixtureLines: TERMINAL_FIXTURES.large.lines,
      fixtureBytes: byteLength(output),
      firstPaintMs,
      scrollFrameRate: scroll.frameRate,
      scrollRawFrameRate: scroll.rawFrameRate,
      scrollP95FrameMs: scroll.p95FrameMs,
      scrollDroppedFrames: scroll.droppedFrames,
      scrollDroppedFramePercent: scroll.droppedFramePercent,
      resizeMs,
      selectionMs,
      hiddenCpuPercent: hidden.cpuPercent,
      hiddenRawCpuPercent: hidden.rawCpuPercent,
      hiddenFixtureCpuPercent: hidden.fixtureCpuPercent,
      hiddenHeapDeltaBytes: hidden.heapDeltaBytes,
      hiddenOutputFrames: hidden.frames,
      reopenMs,
      reopenDroppedFrames: reopenFrames.droppedFrames,
      reopenDroppedFramePercent: reopenFrames.droppedFramePercent,
      ...prefixedMetricFields("open", before, afterOpen, Math.max(firstPaintMs, 1)),
      ...prefixedMetricFields("reopen", beforeReopen, afterReopen, Math.max(reopenMs, 1)),
      openDroppedFrames: openFrames.droppedFrames,
      openDroppedFramePercent: openFrames.droppedFramePercent,
      heapUsedBytes: afterReopen.JSHeapUsedSize ?? 0,
    });
  } finally {
    await opened.context.close();
  }
}

async function openHarnessPage(target, terminalOutputValue) {
  const fixture = createFixture({
    threadCount: 25,
    entryCount: 10,
    terminalOutput: terminalOutputValue,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installPerformanceBridge, fixture);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${target.url}#/threads/${fixture.primaryThreadId}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await waitForText(page, fixture.lastEntryText);
  return { context, page, errors };
}

async function openTerminal(page, marker) {
  await page.getByRole("button", { name: "Add tab" }).first().click();
  await armClick(page);
  await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
  await waitForTerminalText(page, marker);
  const paintedAt = await nextPaint(page);
  const clickedAt = await page.evaluate(() => window.__terminalClickAt);
  return paintedAt - clickedAt;
}

async function reopenTerminal(page, marker) {
  await armClick(page);
  await page.getByRole("tab", { name: /^Terminal/ }).click();
  await waitForTerminalText(page, marker);
  const paintedAt = await nextPaint(page);
  const clickedAt = await page.evaluate(() => window.__terminalClickAt);
  return paintedAt - clickedAt;
}

async function armClick(page) {
  await page.evaluate(() => {
    window.__terminalClickAt = undefined;
    document.addEventListener("click", () => {
      window.__terminalClickAt = performance.now();
    }, { capture: true, once: true });
  });
}

async function measureInputLatency(page) {
  const textarea = page.locator(".xterm-helper-textarea");
  await textarea.focus();
  const samples = [];
  for (let index = 0; index < INPUT_SAMPLES; index += 1) {
    const marker = `input-${index.toString().padStart(2, "0")}`;
    await page.evaluate(() => { window.__terminalInputAt = performance.now(); });
    await page.keyboard.insertText(marker);
    const paintedAt = await waitForTerminalText(page, marker);
    const startedAt = await page.evaluate(() => window.__terminalInputAt);
    samples.push(paintedAt - startedAt);
  }
  return samples;
}

async function emitContinuousOutput(page) {
  return page.evaluate(async ({ id, fixture, interval }) => {
    const rows = document.querySelector(".xterm-rows");
    const pending = new Map();
    const samples = [];
    const encoder = new TextEncoder();
    let bytes = 0;
    const observer = new MutationObserver(() => {
      const text = rows?.textContent ?? "";
      for (const [marker, startedAt] of pending) {
        if (!text.includes(marker)) continue;
        samples.push(performance.now() - startedAt);
        pending.delete(marker);
      }
    });
    if (rows) observer.observe(rows, { childList: true, characterData: true, subtree: true });
    const startedAt = performance.now();
    for (let index = 0; index < fixture.frames; index += 1) {
      const marker = `__frame_${index.toString().padStart(3, "0")}__`;
      const line = `${marker}${"x".repeat(Math.max(0, fixture.columns - marker.length))}\r\n`;
      const data = line.repeat(fixture.linesPerFrame);
      bytes += encoder.encode(data).byteLength;
      pending.set(marker, performance.now());
      window.__remyPerf.emitTerminal(id, data);
      await new Promise((resolveFrame) => setTimeout(resolveFrame, interval));
    }
    await new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
    observer.disconnect();
    return {
      bytes,
      durationMs: performance.now() - startedAt,
      paintSamples: samples,
      missingPaintSamples: pending.size,
    };
  }, { id: terminalId, fixture: TERMINAL_FIXTURES.continuous, interval: OUTPUT_INTERVAL_MS });
}

async function measureTerminalScroll(page, capacity) {
  const intervals = await page.evaluate(async () => {
    const terminal = document.querySelector('section[aria-label="Terminal"]');
    const viewport = terminal
      ? [terminal, ...terminal.querySelectorAll("*")]
        .filter((element) => element.scrollHeight - element.clientHeight > 40)
        .sort((left, right) =>
          (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))[0]
      : undefined;
    if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
      return undefined;
    }
    const intervals = [];
    let previous;
    const duration = 1_200;
    const startedAt = performance.now();
    await new Promise((resolveScroll) => {
      const frame = (now) => {
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        const progress = Math.min(1, (now - startedAt) / duration);
        const triangle = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2;
        viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) * triangle;
        if (progress < 1) requestAnimationFrame(frame);
        else resolveScroll();
      };
      requestAnimationFrame(frame);
    });
    return intervals;
  });
  if (!intervals) {
    return { frameRate: 0, rawFrameRate: 0, p95FrameMs: 1_000, droppedFrames: 1, droppedFramePercent: 100 };
  }
  return frameSummary(intervals, capacity);
}

async function measureResize(page) {
  await resetMeasurements(page);
  await page.evaluate(() => {
    window.__terminalResizeAt = undefined;
    window.addEventListener("resize", () => {
      window.__terminalResizeAt ??= performance.now();
    }, { once: true });
  });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForFunction(() => {
    const request = window.__remyPerf.requests.find((entry) => /\/terminals\/[^/]+\/resize$/.test(entry.path));
    return request && window.__terminalResizeAt !== undefined ? request.end : false;
  }, undefined, { timeout: TIMEOUT_MS, polling: "raf" });
  const startedAt = await page.evaluate(() => window.__terminalResizeAt);
  const paintedAt = await nextPaint(page);
  return paintedAt - startedAt;
}

async function measureSelection(page) {
  await page.evaluate(() => {
    window.__terminalSelection = { startedAt: undefined, selectedAt: undefined };
    const screen = document.querySelector(".xterm-screen");
    screen?.addEventListener("mousedown", () => {
      window.__terminalSelection.startedAt = performance.now();
      const watch = () => {
        if (document.querySelector(".xterm-selection div")) {
          window.__terminalSelection.selectedAt = performance.now();
        } else if (window.__terminalSelection.selectedAt === undefined) {
          requestAnimationFrame(watch);
        }
      };
      requestAnimationFrame(watch);
    }, { capture: true, once: true });
  });
  const box = await page.locator(".xterm-screen").boundingBox();
  if (!box) return Number.NaN;
  const y = box.y + Math.min(30, box.height / 3);
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(320, box.width - 20), y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__terminalSelection.selectedAt !== undefined, undefined, {
    timeout: TIMEOUT_MS,
    polling: "raf",
  });
  return page.evaluate(() =>
    window.__terminalSelection.selectedAt - window.__terminalSelection.startedAt);
}

async function measureHiddenOutput(page, session) {
  await page.getByRole("tab", { name: /Performance thread 1/ }).click();
  await page.waitForFunction(() => !document.querySelector(".xterm-screen"));
  const fixtureCost = await emitHiddenFrames(page, session, "fixture-control", "control");
  const terminalCost = await emitHiddenFrames(page, session, terminalId, "hidden");
  return {
    marker: terminalCost.marker,
    frames: TERMINAL_FIXTURES.continuous.frames,
    cpuPercent: Math.max(0, terminalCost.cpuPercent - fixtureCost.cpuPercent),
    rawCpuPercent: terminalCost.cpuPercent,
    fixtureCpuPercent: fixtureCost.cpuPercent,
    heapDeltaBytes: terminalCost.heapDeltaBytes,
  };
}

async function emitHiddenFrames(page, session, id, prefix) {
  const before = await metricSnapshot(session);
  const hidden = await page.evaluate(async ({ terminal, frames, interval, markerPrefix }) => {
    let marker = "";
    const startedAt = performance.now();
    for (let index = 0; index < frames; index += 1) {
      marker = `__${markerPrefix}_${index.toString().padStart(3, "0")}__`;
      window.__remyPerf.emitTerminal(terminal, `${marker}\r\n`);
      await new Promise((resolveFrame) => setTimeout(resolveFrame, interval));
    }
    return { durationMs: performance.now() - startedAt, marker };
  }, {
    terminal: id,
    frames: TERMINAL_FIXTURES.continuous.frames,
    interval: OUTPUT_INTERVAL_MS,
    markerPrefix: prefix,
  });
  const after = await metricSnapshot(session);
  return {
    marker: hidden.marker,
    cpuPercent: cpuPercent(before, after, hidden.durationMs),
    heapDeltaBytes: (after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0),
  };
}

async function cdpSession(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  return session;
}

async function metricSnapshot(session) {
  const answer = await session.send("Performance.getMetrics");
  return Object.fromEntries(answer.metrics.map((metric) => [metric.name, metric.value]));
}

function metricFields(before, after, durationMs) {
  return {
    cpuPercent: cpuPercent(before, after, durationMs),
    heapUsedBytes: after.JSHeapUsedSize ?? 0,
    heapDeltaBytes: (after.JSHeapUsedSize ?? 0) - (before.JSHeapUsedSize ?? 0),
  };
}

function prefixedMetricFields(prefix, before, after, durationMs) {
  const fields = metricFields(before, after, durationMs);
  return {
    [`${prefix}CpuPercent`]: fields.cpuPercent,
    [`${prefix}HeapDeltaBytes`]: fields.heapDeltaBytes,
  };
}

function cpuPercent(before, after, durationMs) {
  const taskSeconds = (after.TaskDuration ?? 0) - (before.TaskDuration ?? 0);
  const measuredSeconds = (after.Timestamp ?? 0) - (before.Timestamp ?? 0);
  const elapsedSeconds = measuredSeconds > 0 ? measuredSeconds : durationMs / 1_000;
  return (taskSeconds / Math.max(elapsedSeconds, 0.001)) * 100;
}

async function measureFrameCapacity(page) {
  return page.evaluate(() => new Promise((resolveCapacity) => {
    const intervals = [];
    let previous;
    const startedAt = performance.now();
    const frame = (now) => {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (now - startedAt < 500) requestAnimationFrame(frame);
      else {
        const elapsed = intervals.reduce((total, value) => total + value, 0);
        resolveCapacity(elapsed > 0 ? (intervals.length * 1_000) / elapsed : 60);
      }
    };
    requestAnimationFrame(frame);
  }));
}

async function startFrameProbe(page) {
  await page.evaluate(() => {
    window.__terminalFrames = { active: true, intervals: [], previous: undefined };
    const frame = (now) => {
      const probe = window.__terminalFrames;
      if (!probe?.active) return;
      if (probe.previous !== undefined) probe.intervals.push(now - probe.previous);
      probe.previous = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function stopFrameProbe(page, capacity) {
  const intervals = await page.evaluate(() => {
    window.__terminalFrames.active = false;
    return window.__terminalFrames.intervals;
  });
  return frameSummary(intervals, capacity);
}

function frameSummary(intervals, capacity) {
  const elapsed = intervals.reduce((total, value) => total + value, 0);
  const rawFrameRate = elapsed > 0 ? (intervals.length * 1_000) / elapsed : 0;
  const frameRate = capacity > 0 ? Math.min(60, (rawFrameRate / capacity) * 60) : 0;
  const expectedFrameMs = 1_000 / Math.max(capacity, 1);
  const droppedFrames = intervals.reduce(
    (total, value) => total + Math.max(0, Math.round(value / expectedFrameMs) - 1),
    0,
  );
  const expectedFrames = intervals.length + droppedFrames;
  return {
    frameRate,
    rawFrameRate,
    frameCapacity: capacity,
    p95FrameMs: percentile(intervals, 95),
    droppedFrames,
    droppedFramePercent: expectedFrames > 0 ? (droppedFrames / expectedFrames) * 100 : 0,
  };
}

function frameFields(summary) {
  return {
    frameRate: summary.frameRate,
    rawFrameRate: summary.rawFrameRate,
    frameCapacity: summary.frameCapacity,
    p95FrameMs: summary.p95FrameMs,
    droppedFrames: summary.droppedFrames,
    droppedFramePercent: summary.droppedFramePercent,
  };
}

async function resetMeasurements(page) {
  await page.evaluate(() => window.__remyPerf.resetMeasurements());
}

async function waitForTerminalText(page, marker) {
  return page.waitForFunction(
    (text) => document.querySelector(".xterm-rows")?.textContent?.includes(text) ? performance.now() : false,
    marker,
    { timeout: TIMEOUT_MS, polling: "raf" },
  ).then((handle) => handle.jsonValue());
}

async function waitForText(page, marker) {
  await page.waitForFunction(
    (text) => document.body?.innerText.includes(text),
    marker,
    { timeout: TIMEOUT_MS, polling: "raf" },
  );
}

async function nextPaint(page) {
  return page.evaluate(() => new Promise((resolvePaint) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint(performance.now())));
  }));
}

function terminalMarker(output) {
  return output.trimEnd().split("\r\n").at(-1).trimEnd();
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function withErrors(errors, result) {
  return errors.length > 0 ? { ...result, pageErrors: [...errors] } : result;
}

async function repeated(run) {
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) samples.push(await run());
  if (samples.length === 1) return samples[0];
  const combined = { ...samples[Math.floor(samples.length / 2)], runs: samples.length };
  for (const key of new Set(samples.flatMap((sample) => Object.keys(sample)))) {
    const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
    if (values.length > 0) combined[key] = percentile(values, 50);
  }
  for (const key of ["inputSamples"]) {
    if (samples.some((sample) => Array.isArray(sample[key]))) {
      combined[key] = samples.flatMap((sample) => sample[key] ?? []);
    }
  }
  combined.pageErrors = [...new Set(samples.flatMap((sample) => sample.pageErrors ?? []))];
  if (combined.pageErrors.length === 0) delete combined.pageErrors;
  return combined;
}

function performanceTargets() {
  const currentIndex = process.env.MC_TERMINAL_CURRENT ?? resolve(webRoot, "dist/index.html");
  const current = {
    name: process.env.MC_TERMINAL_CURRENT_LABEL ?? "current",
    role: "current",
    url: targetUrl(currentIndex),
  };
  const candidates = (process.env.MC_TERMINAL_CANDIDATES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator < 1) throw new Error(`Invalid MC_TERMINAL_CANDIDATES entry: ${entry}`);
      return {
        name: entry.slice(0, separator),
        role: "candidate",
        url: targetUrl(entry.slice(separator + 1)),
      };
    });
  return [current, ...candidates];
}

function targetUrl(input) {
  if (/^https?:\/\//.test(input) || input.startsWith("file:")) return input;
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`Terminal benchmark target is missing at ${path}`);
  return pathToFileURL(path).href;
}

function compareCandidates(allResults, currentName) {
  const baseline = new Map(allResults
    .filter((result) => result.target === currentName)
    .map((result) => [result.scenario, result]));
  return allResults
    .filter((result) => result.target !== currentName)
    .map((candidate) => {
      const current = baseline.get(candidate.scenario);
      const fields = comparisonFields(candidate.scenario);
      return {
        target: candidate.target,
        scenario: candidate.scenario,
        metrics: Object.fromEntries(fields.map((field) => [field, {
          current: current?.[field],
          candidate: candidate[field],
          changePercent: percentChange(current?.[field], candidate[field]),
        }])),
      };
    });
}

function comparisonFields(scenario) {
  if (scenario === "small-output") return ["firstPaintMs", "inputLatencyP95Ms", "cpuPercent", "heapDeltaBytes"];
  if (scenario === "continuous-output") return ["outputPaintP95Ms", "frameRate", "cpuPercent", "heapDeltaBytes"];
  return ["scrollFrameRate", "resizeMs", "selectionMs", "hiddenCpuPercent", "reopenMs", "heapUsedBytes"];
}

function percentChange(current, candidate) {
  if (!Number.isFinite(current) || !Number.isFinite(candidate) || current === 0) return undefined;
  return ((candidate - current) / current) * 100;
}

function printResults(allResults, comparisons) {
  console.log("\nTerminal performance results");
  for (const result of allResults) {
    console.log(`\n${result.target} / ${result.scenario} (${result.fixtureLines} lines, ${formatBytes(result.fixtureBytes)})`);
    const measures = [
      metric(result.firstPaintMs, "first paint", "ms"),
      metric(result.outputPaintP95Ms, "output paint p95", "ms"),
      metric(result.inputLatencyP95Ms, "input p95", "ms"),
      metric(result.frameRate, "output", "fps"),
      metric(result.scrollFrameRate, "scroll", "fps"),
      metric(result.resizeMs, "resize", "ms"),
      metric(result.selectionMs, "selection", "ms"),
      metric(result.hiddenCpuPercent, "hidden CPU", "%"),
      metric(result.reopenMs, "reopen", "ms"),
      metric(result.cpuPercent ?? result.openCpuPercent, "CPU", "%"),
      metric(result.heapDeltaBytes ?? result.openHeapDeltaBytes, "heap delta", "bytes"),
      metric(result.heapUsedBytes, "heap used", "bytes"),
      metric(result.droppedFrames ?? result.scrollDroppedFrames, "dropped frames", "count"),
    ].filter(Boolean).join(" · ");
    console.log(`  ${measures}`);
    if (result.missingPaintSamples > 0) console.log(`  ${result.missingPaintSamples} output markers were not individually painted`);
    for (const error of result.pageErrors ?? []) console.log(`  page error: ${error}`);
  }
  console.log("\nApplicable REMY-29 budgets");
  console.log(
    `  first paint ≤${TERMINAL_PERFORMANCE_BUDGETS.firstPaintMs}ms`
    + ` · reopen ≤${TERMINAL_PERFORMANCE_BUDGETS.reopenMs}ms`
    + ` · output/input p95 ≤${TERMINAL_PERFORMANCE_BUDGETS.livePaintP95Ms}ms`,
  );
  console.log(
    `  sustained output and large scrollback ≥${TERMINAL_PERFORMANCE_BUDGETS.minimumFrameRate}fps`
    + ` · hidden CPU ≤${TERMINAL_PERFORMANCE_BUDGETS.hiddenCpuPercent}%`,
  );
  if (comparisons.length === 0) {
    console.log("\nNo candidate renderer configured; this run records the current renderer only.");
  } else {
    console.log("\nCandidate changes from current");
    for (const comparison of comparisons) {
      const changes = Object.entries(comparison.metrics)
        .map(([field, values]) => Number.isFinite(values.changePercent)
          ? `${field} ${values.changePercent >= 0 ? "+" : ""}${values.changePercent.toFixed(1)}%`
          : "")
        .filter(Boolean)
        .join(" · ");
      console.log(`  ${comparison.target} / ${comparison.scenario}: ${changes}`);
    }
  }
}

function metric(value, label, unit) {
  if (!Number.isFinite(value)) return "";
  if (unit === "bytes") return `${label} ${formatBytes(value)}`;
  if (unit === "count") return `${label} ${Math.round(value)}`;
  return `${label} ${value.toFixed(1)}${unit}`;
}

function formatBytes(value) {
  if (Math.abs(value) < 1_024) return `${Math.round(value)}B`;
  if (Math.abs(value) < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function positiveInteger(raw, fallback) {
  const parsed = Number(raw ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
