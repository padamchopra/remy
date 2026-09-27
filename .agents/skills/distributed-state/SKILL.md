---
name: distributed-state
description: Distributed state paths in Remy. Use before changing ANY capability that reads, writes, streams, resumes, or synchronizes data across the hub, connected computers, or cloud execution.
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

The browser reaches a computer only through the hub. A member session authenticates the page; the computer proves itself with its own keypair over its outbound connection, and computer credentials never enter the browser (`hub/docs/threads.md`). The hub checks membership and access, and the computer checks them again before it acts.

Do not put a computer credential in the page or widen the loopback bind. Computers do not reach each other: there is no peer routing, daemon-to-daemon board sync or tailnet exposure, so a path that needs another computer's state goes through the hub.

## Hosted thread start uses the computer's providers

A hosted new thread independently chooses placement and model access. Placement is the owner's Personal cloud connection or connected computer unless that exact computer or named cloud key is enrolled for every member of the organization. Model access is the starter's own subscription or named key unless the picker chooses an exact named key another member enrolled for everyone. The owner needs no organization grant to use their own resources. Organization grants store stable source ids and key ids, never credential values.

The computer picker sends the exact connected computer or cloud key grant. The model picker sends the exact subscription or model-key grant. The thread stores both choices for its life. At start, resume, and cloud boot, check current membership, that each grant still exists, and that the referenced key still belongs to its source. Revocation stops new use and prevents a restarted thread from receiving that credential. Existing connected-computer threads stay writable while their computer remains available.

Normalize a gateway provider such as `openrouter` onto Codex plus a `remy:` model for execution, then map that runtime back to the chosen model grant when checking access. A fetched catalogue names choices but is not a second allowlist. Management APIs return owners, key names, selected ids, and configured state, never values. Agent capabilities cannot manage credentials or grants.

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

If a second computer is unavailable, keep the integration test and report the missing interaction proof instead of substituting a thread on the same computer.
