# Terminal rendering baseline

Measured on 2 September 2026 from `c2afea7` with the current `@xterm/xterm` 6 renderer. The machine was an Apple M4 Pro with 48 GB of memory on macOS 26.2. The runner used Chrome for Testing 148 and reports the median of three runs.

## Result

The current renderer passes every applicable REMY-29 budget. No separate renderer implementation is justified by this baseline.

| Budgeted behavior | Budget | Current |
|---|---:|---:|
| First paint, 100 lines | 500 ms | 361.3 ms |
| First paint, 10,000 lines | 500 ms | 396.8 ms |
| Input latency, p95 | 50 ms | 37.0 ms |
| Continuous output paint, p95 | 50 ms | 13.1 ms |
| Continuous output frame rate | 60 fps | 60.0 fps |
| Large scrollback frame rate | 60 fps | 60.0 fps |
| Hidden terminal CPU above fixture delivery | 1% | 0.0% |
| Reopen | 150 ms | 58.6 ms |

Resize, selection, and memory do not have an agreed budget, so the runner records them without turning them into a pass or failure.

## Measurements

| Interaction | Fixture | Latency or rate | CPU | JavaScript heap | Dropped frames |
|---|---|---:|---:|---:|---:|
| First paint | 100 lines, 7.2 KB | 361.3 ms | 28.4% | +9.8 MB, 21.2 MB used | 5 |
| Input | 12 samples per run | 32.0 ms p50, 37.0 ms p95 | — | — | — |
| Sustained output | 120 frames over 2.0 s, 480 lines, 34.7 KB | 13.1 ms paint p95, 60.0 fps | 17.3% | +3.7 MB, 24.1 MB used | 0 |
| First paint | 10,000 lines, 488.3 KB | 396.8 ms | 33.3% | +8.1 MB | 8 |
| Resize | 1440 × 1000 to 1180 × 820 | 119.0 ms | — | — | — |
| Scrollback | 10,000 lines, end to start and back | 60.0 fps, 9.2 ms frame p95 | — | — | 0 |
| Selection | One rendered row | 14.7 ms | — | — | — |
| Hidden output | 120 frames over 2.0 s | — | 0.0% above delivery control | +128 KB | — |
| Reopen | 10,000-line session plus hidden output | 58.6 ms | 68.9% during reopen | +3.1 MB, 18.6 MB used | 3 |

Hidden output used 1.46% raw browser CPU while the identical fixture delivery loop used 2.97%. The reported terminal cost is the non-negative difference, which removes the benchmark's own timers, payload creation, and dispatch work.

## Reproduction and comparison

Run the current renderer with:

```sh
npm run perf:terminal
```

Write the complete measurements as JSON with:

```sh
MC_TERMINAL_PERF_OUTPUT=/tmp/remy-terminal-performance.json npm run perf:terminal
```

Compare one or more candidate Remy web bundles with the same fixtures:

```sh
MC_TERMINAL_CANDIDATES=candidate=/absolute/path/to/index.html npm run perf:terminal
```

Separate candidates with commas. The first target is always the current bundle, and candidate results include percentage changes from it for the matching fixture and interaction.

The benchmark injects the same deterministic Electron transport into every target. It measures renderer work without opening a real terminal or changing Remy data. CPU is Chromium main-thread task time, memory is JavaScript heap usage, and dropped frames are normalized against the display capacity measured immediately before each interaction.
