---
name: performance-diagnosis
description: Perceived performance and stale UI diagnosis in Remy. Use when ANY pane, thread, or cross-device interaction feels slow, duplicates work, blocks on another device, or updates only after navigation.
---

# Performance diagnosis

`distributed-state` owns cross-boundary correctness. `qa` owns interaction proof. This skill owns locating the wait and choosing the smallest architectural fix.

## Measure the wait

Reproduce the person's exact route and state before changing code. “The list loaded” is not evidence for a slow detail pane, and a local thread is not evidence for a remote one.

Capture these milestones when they apply:

- Document ready.
- Local catalogue returned.
- Remote catalogue returned.
- Selected detail returned.
- First useful content painted.
- First live update painted.

Record every request's method, path, start, finish, and count. Separate network wait, payload processing, React work, and paint rather than assigning the whole duration to the slowest visible component.

Use `npm run perf` for the panes it covers. Extend the measurement or run a focused browser trace when the reported interaction is absent from that harness.

## Do not put one read behind another

Two reads of the same account are parallel work. Chaining them because the second one's code happens to reference the first one's result adds a full round trip to every open, and the cost is worst where the second read is the slow one — a provider's API rather than our own.

Before gating a read, ask what the first one actually tells you that the second cannot. A listing that fails with "not connected" already answers whether the account is connected, so waiting for a connections resource to say the same thing first buys nothing and costs a round trip.

BAD
```tsx
const github = connection.value?.connections.find(...);
useEffect(() => {
  if (!github) return;              // the GitHub call waits for our own hub
  void load(1);
}, [github?.id]);
```

GOOD
```tsx
useEffect(() => {
  void load(1);                     // starts with everything else
}, [root]);                         // a 409 means "not connected"
```

A subscription's first open is not a reason to read again. The read issued when the watcher was created already covers it; only a reconnect has missed messages. Refreshing on every open asks for every resource twice.

## Performance is part of finishing a surface

A surface is not done when it works. Open it with the network panel honest — request count, their order, and whether any of them wait on each other — before calling it done. A waterfall is easiest to remove on the day it is written and hardest to notice once it ships, because every individual request looks fast.

Re-measure after the fix and report both numbers, including the request count. Keep in the evidence which data source answered: a fixture that serves a provider from localhost proves the ordering, not the magnitude.

## Classify before fixing

| Finding | Direction |
|---|---|
| Unrelated device holds up local content | Land each source independently or remove the dependency. |
| Same request appears more than once | Deduplicate the shared async boundary; do not special-case one component mount. |
| Fresh data appears only after reopening | Trace invalidation and subscription before adding a timer. |
| Detail arrived but paint is late | Bound initial rendering and defer history that is not needed for first use. |
| Warm reopen repeats a full wait | Paint a bounded cache immediately and refresh it in the background. |
| One loading flag redirects or replaces useful UI | Separate catalogue, detail, and mutation loading states. |

Do not start with polling when an event path is missing. Do not start with memoization when the request waterfall contains the wait.

## Preserve behavior while improving it

A cache has a bound, an invalidation rule, and a fresh read. An in-flight request map clears on both success and failure.

Parallel reads land independently when partial results are useful. Failures on one device do not erase known workspaces or threads from another device.

Deep links wait only for the catalogue needed to decide whether their entity exists. They do not redirect while a remote source is still answering.

## Re-measure the same interaction

Compare cold open, warm reopen, live update, unavailable peer, reconnect, and deep-link reload.

Confirm request counts as well as elapsed time. A faster median that still performs duplicate remote calls is not complete.

Keep the preview and data source in the evidence: current UI against the packaged daemon proves a different boundary than current UI against the isolated current server.
