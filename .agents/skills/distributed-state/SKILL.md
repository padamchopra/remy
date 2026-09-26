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

The renderer reaches a paired machine through the local daemon in `web/src/lib/transport.ts`; the paired machine's token stays in `server/src/peers.ts` and never enters the browser. The native phone is different: it is a fleet client, keeps direct computer credentials in secure storage, and may learn one through an authenticated paired-computer route.

Live peer events follow the same ownership: `server/src/peer-stream.ts` authenticates to the paired daemon, `server/src/notify.ts` supplies resumable frames, and the local daemon relays those frames to its clients.

Do not put a peer token in the renderer or widen the loopback bind. Only the native phone independently maintains privileged peer connections, because it cannot host a daemon that could proxy them.

## Hosted thread start uses the computer's providers

A hosted new thread runs on the computer the composer chose. That computer's enabled providers are the start allowlist: org model access for a cloud computer, the Mac's advertised providers for a paired computer. The owner of a Personal computer always receives that computer in the organization list and can start on it, even when organization share is off; other members need the grant. A Personal computer or cloud connection shared into an organization further restricts start for everyone except the owner to the providers the owner left on. Existing threads stay writable for participants even when they could not have started with that provider. A cloud computer shared into an organization uses the source account's enabled model access, including OpenRouter, then that share's start allowlist. If OpenRouter (or another gateway) is enabled there and left on for others, start accepts the selected model. Do not reject it because a fetched catalogue is stale, incomplete, or missing a default such as `openrouter/auto`. The share list and grant store those gateway ids. Normalize a gateway provider such as `openrouter` onto Codex plus a `remy:` model for execution, then map that remapped runtime back to the gateway when checking the grant; a missing runtime provider is not a refusal when the model already names that gateway. A saved default is not itself allowlist: once model access has arrived, only enabled and configured providers are sendable, and an unconfigured default falls back to one that is. Read the same access records start uses, including a legacy OpenRouter key when the newer access row has none. Credentials stay on the source Personal account. An account can keep multiple named Fly.io, OpenRouter, and other integration keys; execution and sharing use the active key. An organization lists its own named keys; a shared computer still starts with the source account's active key. Management APIs return names and configured state, never values, and agent capabilities cannot manage them.

BAD
```text
Fly.io is shared into an organization from Personal, where OpenRouter is on.
The organization catalogue is empty. POST /threads returns 400 Choose an enabled provider and model.
```

GOOD
```text
Fly.io is shared into an organization from Personal, where OpenRouter is on.
Members see OpenRouter and start private or shared threads on that computer.
The organization can still turn OpenRouter off for itself.
```

## A status has to survive the boundary

An error's status is the part a caller branches on. Collapsing every failure to one status at the edge leaves the client unable to tell "you are not connected" from "you sent a bad page number", and the client then either guesses from the message or treats a normal state as a failure.

Carry the status the error was raised with. `ConnectionError` already holds one; a route that answers `400` for all of them throws that away.

BAD
```ts
} catch (e) {
  return Response.json({ error: message(e) }, { status: 400 });
}
```

GOOD
```ts
} catch (e) {
  return Response.json({ error: message(e) }, { status: e instanceof ConnectionError ? e.status : 400 });
}
```

Then make the client survive being wrong about it anyway. A read that fails in an expected state should fall back to the screen that state deserves, not to an error paragraph that replaces it.

## Choose freshness deliberately

Use push for state somebody is actively watching. Polling is a compatibility or recovery path with an explicit condition that turns it off when push is available.

A reconnect either resumes from a monotonic cursor or invalidates affected state and performs a full read. A bounded event history therefore needs a reset signal when the requested cursor is no longer available.

Patch an open detail from live frames when the event contains enough state. Refetch only the entity that cannot be patched; do not turn one remote event into a full fleet refresh.

Keep cached detail useful while a fresh read is in flight, but never treat the cache as proof that the owner accepted a write.

## Prove the topology

Test authorization, forwarding, ordering, duplicate suppression, reconnect, reset, and shutdown at the relay boundary.

Then run the remote-live scenario in `qa`: keep a remote thread open while it changes, reconnect it, reload its deep link, and verify that no navigation is required for freshness.

If a paired device is unavailable, keep the integration test and report the missing interaction proof instead of substituting a local-only thread.
