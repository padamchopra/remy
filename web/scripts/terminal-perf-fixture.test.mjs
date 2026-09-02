import assert from "node:assert/strict";
import test from "node:test";
import {
  TERMINAL_FIXTURES,
  TERMINAL_PERFORMANCE_BUDGETS,
  terminalBudgetFailures,
  terminalOutput,
} from "./terminal-perf-fixture.mjs";

test("builds stable small, continuous, and large terminal fixtures", () => {
  const small = terminalOutput(TERMINAL_FIXTURES.small);
  const large = terminalOutput(TERMINAL_FIXTURES.large);

  assert.equal(small.split("\r\n").length - 1, 100);
  assert.equal(large.split("\r\n").length - 1, 10_000);
  assert.equal(new TextEncoder().encode(small).byteLength, 7_400);
  assert.equal(new TextEncoder().encode(large).byteLength, 500_000);
});

test("applies only the parent budgets that already govern terminal behavior", () => {
  const passing = [
    {
      scenario: "small-output",
      firstPaintMs: TERMINAL_PERFORMANCE_BUDGETS.firstPaintMs,
      inputLatencyP95Ms: TERMINAL_PERFORMANCE_BUDGETS.inputLatencyP95Ms,
      cpuPercent: 20,
      heapDeltaBytes: 1_000,
      droppedFrames: 0,
    },
    {
      scenario: "continuous-output",
      outputPaintP95Ms: TERMINAL_PERFORMANCE_BUDGETS.livePaintP95Ms,
      frameRate: TERMINAL_PERFORMANCE_BUDGETS.minimumFrameRate,
      cpuPercent: 20,
      heapDeltaBytes: 1_000,
      droppedFrames: 0,
      missingPaintSamples: 0,
    },
    {
      scenario: "large-scrollback",
      firstPaintMs: TERMINAL_PERFORMANCE_BUDGETS.firstPaintMs,
      scrollFrameRate: TERMINAL_PERFORMANCE_BUDGETS.minimumFrameRate,
      hiddenCpuPercent: TERMINAL_PERFORMANCE_BUDGETS.hiddenCpuPercent,
      reopenMs: TERMINAL_PERFORMANCE_BUDGETS.reopenMs,
      resizeMs: 2_000,
      selectionMs: 2_000,
      scrollDroppedFrames: 0,
      openCpuPercent: 20,
      openHeapDeltaBytes: 200_000_000,
      reopenDroppedFrames: 0,
      heapUsedBytes: 200_000_000,
    },
  ];
  assert.deepEqual(passing.flatMap((result) => terminalBudgetFailures(result)), []);

  const [small, continuous, large] = passing;
  assert.match(terminalBudgetFailures({ ...small, firstPaintMs: 501 }).join("\n"), /first paint/);
  assert.match(terminalBudgetFailures({ ...continuous, frameRate: 50 }).join("\n"), /continuous output/);
  assert.match(terminalBudgetFailures({ ...large, firstPaintMs: 501 }).join("\n"), /first paint/);
  assert.match(terminalBudgetFailures({ ...large, hiddenCpuPercent: 1.1 }).join("\n"), /hidden terminal CPU/);
  assert.match(terminalBudgetFailures({ ...large, reopenMs: 151 }).join("\n"), /reopen/);
  assert.match(
    terminalBudgetFailures({ scenario: "continuous-output", outputPaintP95Ms: 1, frameRate: 60 }).join("\n"),
    /missing cpuPercent measurement/,
  );
});
