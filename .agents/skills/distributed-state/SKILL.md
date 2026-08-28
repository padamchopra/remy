---
name: distributed-state
description: Distributed state paths in Remy. Use before changing ANY capability that reads, writes, streams, resumes, or synchronizes data across paired devices, cloud execution, Electron IPC, or the browser proxy.
---

# Distributed state

`product-design` owns the capability and its durable owner. `qa` owns observable proof. This skill owns the technical path between owners, actors, and clients.

## Draw the complete path

Before editing, identify each path for the affected entity:

| Path | Decide |
|---|---|
| Durable state | Which process and machine own the source of truth? |
| Credentials | Which trusted process holds the credential needed to reach it? |
| Read | How do list and detail views reach the owner? |
| Write | Where is authorization checked and where is the result read back? |
| Live update | Which process emits the event and how does the current client receive it? |
| Reconnect | How are missed events resumed, deduplicated, or replaced by a full read? |
| Unavailable owner | What useful state remains visible and what is explicitly stale? |

An entity that can be read across a boundary needs a corresponding live-update and reconnect path. Extending `request()` does not extend `subscribe()`.

Check local and remote list, detail, write, live-update, reconnect, restart, and unavailable-owner behavior. A path is incomplete when one cell relies on changing routes or reopening the view to refresh.

## Keep Remy's trust boundary

The renderer reaches a paired machine through the local daemon in `web/src/lib/transport.ts`; the paired machine's token stays in `server/src/peers.ts`.

Live peer events follow the same ownership: `server/src/peer-stream.ts` authenticates to the paired daemon, `server/src/notify.ts` supplies resumable frames, and the local daemon relays those frames to its clients.

Do not put a peer token in the renderer, widen the loopback bind, or make each client independently maintain privileged peer connections.

## Choose freshness deliberately

Use push for state somebody is actively watching. Polling is a compatibility or recovery path with an explicit condition that turns it off when push is available.

A reconnect either resumes from a monotonic cursor or invalidates affected state and performs a full read. A bounded event history therefore needs a reset signal when the requested cursor is no longer available.

Patch an open detail from live frames when the event contains enough state. Refetch only the entity that cannot be patched; do not turn one remote event into a full fleet refresh.

Keep cached detail useful while a fresh read is in flight, but never treat the cache as proof that the owner accepted a write.

## Prove the topology

Test authorization, forwarding, ordering, duplicate suppression, reconnect, reset, and shutdown at the relay boundary.

Then run the remote-live scenario in `qa`: keep a remote thread open while it changes, reconnect it, reload its deep link, and verify that no navigation is required for freshness.

If a paired device is unavailable, keep the integration test and report the missing interaction proof instead of substituting a local-only thread.
