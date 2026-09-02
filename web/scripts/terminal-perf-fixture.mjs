export const TERMINAL_PERFORMANCE_BUDGETS = Object.freeze({
  firstPaintMs: 500,
  reopenMs: 150,
  livePaintP95Ms: 50,
  inputLatencyP95Ms: 50,
  minimumFrameRate: 60,
  hiddenCpuPercent: 1,
});

export const TERMINAL_FIXTURES = Object.freeze({
  small: Object.freeze({ lines: 100, columns: 72 }),
  continuous: Object.freeze({ frames: 120, linesPerFrame: 4, columns: 72 }),
  large: Object.freeze({ lines: 10_000, columns: 48 }),
});

export function terminalOutput({ lines, columns }, prefix = "Fixture") {
  return Array.from({ length: lines }, (_, index) => {
    const number = String(index + 1).padStart(5, "0");
    const body = `${prefix} ${number} `;
    return `${body}${"x".repeat(Math.max(0, columns - body.length))}\r\n`;
  }).join("");
}

export function terminalBudgetFailures(result, budgets = TERMINAL_PERFORMANCE_BUDGETS) {
  const failures = [];
  const requireMetrics = (fields) => {
    for (const field of fields) {
      if (!Number.isFinite(result[field])) failures.push(`missing ${field} measurement`);
    }
  };
  const over = (value, limit, label, unit = "ms") => {
    if (Number.isFinite(value) && value > limit) {
      failures.push(`${label}: ${value.toFixed(1)} ${unit} > ${limit} ${unit}`);
    }
  };
  const under = (value, limit, label) => {
    if (Number.isFinite(value) && value + 0.5 < limit) {
      failures.push(`${label}: ${value.toFixed(1)} fps < ${limit} fps`);
    }
  };

  if (result.scenario === "small-output") {
    requireMetrics(["firstPaintMs", "inputLatencyP95Ms", "cpuPercent", "heapDeltaBytes", "droppedFrames"]);
    over(result.firstPaintMs, budgets.firstPaintMs, "first paint");
    over(result.inputLatencyP95Ms, budgets.inputLatencyP95Ms, "input latency p95");
  }
  if (result.scenario === "continuous-output") {
    requireMetrics([
      "outputPaintP95Ms",
      "frameRate",
      "cpuPercent",
      "heapDeltaBytes",
      "droppedFrames",
      "missingPaintSamples",
    ]);
    over(result.outputPaintP95Ms, budgets.livePaintP95Ms, "continuous output paint p95");
    under(result.frameRate, budgets.minimumFrameRate, "continuous output");
    if (result.missingPaintSamples > 0) failures.push(`${result.missingPaintSamples} output markers were not painted`);
  }
  if (result.scenario === "large-scrollback") {
    requireMetrics([
      "firstPaintMs",
      "scrollFrameRate",
      "scrollDroppedFrames",
      "resizeMs",
      "selectionMs",
      "hiddenCpuPercent",
      "openCpuPercent",
      "openHeapDeltaBytes",
      "reopenMs",
      "reopenDroppedFrames",
      "heapUsedBytes",
    ]);
    over(result.firstPaintMs, budgets.firstPaintMs, "large scrollback first paint");
    under(result.scrollFrameRate, budgets.minimumFrameRate, "large scrollback");
    over(result.hiddenCpuPercent, budgets.hiddenCpuPercent, "hidden terminal CPU", "%");
    over(result.reopenMs, budgets.reopenMs, "reopen");
  }
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join("; ")}`);
  return failures;
}
