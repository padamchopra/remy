# D1: Support multiple hosted computer providers

## Decision

Hosted Remy computers are provisioned through a computer runtime interface. Fly Sprites is the preferred managed default and Modal is supported as an alternative. Local Macs bypass hosted provisioning and connect through the same computer contract.

## Consequences

The hub depends only on the versioned computer protocol. Provider adapters own provision, start, stop, checkpoint, and destroy operations, and advertise persistence capabilities so routing can make an explicit choice.

The H1 Fly proof remains pending until billing can be enabled. Modal gets its own adapter and proof; neither proof blocks local computers.

## Rejected alternatives

- A bespoke virtual-machine platform, because persistence and restore are not product differentiators Remy should build.
- One provider embedded throughout hub code, because it would couple computer orchestration to vendor lifecycle APIs.
