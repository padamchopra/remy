# D4: Make the hub open source and self-hostable

## Decision

The Remy for Teams hub is open source. An org can deploy it to its own Cloudflare and Fly accounts with one command and a setup guide.

## Consequences

Hosted and self-hosted hubs follow the same release train and migrations. Local Remy remains documented as a complete self-setup product.

## Rejected alternatives

- A closed hosted-only control plane, because organisations must be able to own the service boundary.
- Treating local Remy as the self-hosted hub, because the hub has distinct identity, tenancy, routing, and connection responsibilities.
