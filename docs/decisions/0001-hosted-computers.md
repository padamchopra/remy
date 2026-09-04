# D1: Support multiple hosted computer providers

## Decision

Hosted Remy computers are provisioned through a computer runtime interface. Fly Sprites is the preferred managed default and Modal is supported as an alternative. Local Macs bypass hosted provisioning and connect through the same computer contract.

## Consequences

The hub depends only on the versioned computer protocol. Provider adapters own provision, start, stop, checkpoint, and destroy operations, and advertise persistence capabilities so routing can make an explicit choice.

The H1 Fly proof remains pending until billing can be enabled. A Modal V2 Sandbox ran the Remy daemon, Claude Code, and Codex and preserved an edit across a filesystem snapshot. Cached creation took 1.883 seconds, snapshotting took 1.016 seconds, and restore through the first read took 4.128 seconds. No model credential was sent to Modal, so the edit was deterministic rather than agent-authored. Modal proves compatibility but does not meet the sub-second restore target; neither hosted proof blocks local computers.

## Rejected alternatives

- A bespoke virtual-machine platform, because persistence and restore are not product differentiators Remy should build.
- One provider embedded throughout hub code, because it would couple computer orchestration to vendor lifecycle APIs.
