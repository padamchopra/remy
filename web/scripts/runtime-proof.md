# Thread runtime proof

`npm run perf:runtime` builds the current and shared-runtime variants from the
same checkout, runs both against the same deterministic fixtures, and removes
the temporary bundles afterwards. The shared variant is selected only at build
time; the default bundle tree-shakes the proof runtime out.

## Decision

Do not migrate the thread surface to the shared runtime. Continue adapting the
current path.

The shared path covers the same correctness and parent-budget checks, but it
does not materially improve any budget and misses the 60 fps long-thread gate
in the recorded run. It adds a compatibility projection back into Zustand, 703
source lines, and 2.0 KB to the candidate entry bundle. A
future runtime experiment should proceed only if it can remove that projection
and demonstrate a material improvement before another surface moves.

## Evidence

The comparison below is the median of three runs on the isolated production
build. Both variants used the same short, long, streaming, reconnect, and
unavailable-device fixtures and the same React components.

| Measure | Current | Shared | Result |
|---|---:|---:|---|
| Short useful paint | 135.1 ms | 128.8 ms | 4.7% faster |
| Long useful paint | 140.1 ms | 138.0 ms | 1.5% faster |
| 250-thread sidebar paint | 125.2 ms | 137.0 ms | 9.4% slower |
| 500-entry scroll | 60.0 fps | 59.5 fps | Shared misses the 60 fps budget |
| Live response p95 | 2.5 ms | 2.4 ms | Equivalent |
| Reconnect paint | 2.1 ms | 2.4 ms | 0.3 ms slower |
| Warm reopen | 149.0 ms | 144.6 ms | 3.0% faster |
| Unavailable-device paint | 137.3 ms | 139.6 ms | 1.7% slower |
| Long-open requests | 12 | 12 | Equivalent |
| Long-open transferred payload | 10.1 KB | 10.1 KB | Equivalent |
| Live row renders | 1 affected, 0 unrelated | 1 affected, 0 unrelated | Equivalent |
| Median JS heap | 13,237 KB | 13,259 KB | Equivalent |
| Interrupt requests | 1 | 1 | Equivalent |
| Reconnect duplicate entries | 0 | 0 | Equivalent |
| Entry bundle | 944.2 KB | 946.2 KB | 2.0 KB larger |

The runtime sits above the shared `Transport` interface, so Electron IPC and
the browser proxy use the same reads, live topics, reset handling, cache rules,
and mutations. The transport remains responsible for credentials and peer
forwarding; the proof does not change routes, provider execution, pairing, the
database, ticket tools, terminology, or presentation.
