# Thread runtime proof

`npm run perf:runtime` builds the current and shared-runtime variants from the
same checkout, runs both against the same deterministic fixtures, and removes
the temporary bundles afterwards. The shared variant is selected only at build
time; the default bundle tree-shakes the proof runtime out.

## Decision

Do not migrate the thread surface to the shared runtime. Continue adapting the
current path.

The shared path covers the same correctness and parent-budget checks, but its
paint gains do not change whether the current path meets those budgets. Request
count, payload size, render isolation, frame rate, memory, interruption, and
reconnect correctness remain equivalent. It adds a compatibility projection
back into Zustand, 703 source lines, and 1.5 KB to the candidate entry bundle.
A future runtime experiment should proceed only if it can remove that
projection and demonstrate a material improvement before another surface moves.

## Evidence

The comparison below is the median of three runs on the isolated production
build. Both variants used the same short, long, streaming, reconnect, and
unavailable-device fixtures and the same React components.

| Measure | Current | Shared | Result |
|---|---:|---:|---|
| Short useful paint | 134.5 ms | 133.5 ms | 0.7% faster |
| Long useful paint | 145.2 ms | 138.8 ms | 4.4% faster |
| 250-thread sidebar paint | 135.9 ms | 126.4 ms | 7.0% faster |
| 500-entry scroll | 60.0 fps | 60.0 fps | Equivalent |
| Live response p95 | 2.4 ms | 2.2 ms | Equivalent |
| Reconnect paint | 2.1 ms | 2.3 ms | 0.2 ms slower |
| Warm reopen | 149.9 ms | 149.5 ms | Equivalent |
| Unavailable-device paint | 141.2 ms | 139.1 ms | 1.5% faster |
| Long-open requests | 12 | 12 | Equivalent |
| Long-open transferred payload | 10.1 KB | 10.1 KB | Equivalent |
| Live row renders | 1 affected, 0 unrelated | 1 affected, 0 unrelated | Equivalent |
| Median JS heap | 13,255 KB | 13,276 KB | Equivalent |
| Interrupt requests | 1 | 1 | Equivalent |
| Reconnect duplicate entries | 0 | 0 | Equivalent |
| Entry bundle | 947.2 KB | 948.7 KB | 1.5 KB larger |

The runtime sits above the shared `Transport` interface, so Electron IPC and
the browser proxy use the same reads, live topics, reset handling, cache rules,
and mutations. The transport remains responsible for credentials and peer
forwarding; the proof does not change routes, provider execution, pairing, the
database, ticket tools, terminology, or presentation.
