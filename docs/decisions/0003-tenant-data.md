# D3: Use one D1 database and one Durable Object per org

## Decision

Global account and membership rows live in one US-region D1 database with location hints. Each org has one Durable Object containing its board log and live stream, referring to members by id.

## Consequences

Tenant checks happen on every D1 access. The board keeps its append-only event and version-vector model inside the org object.

## Rejected alternatives

- A database per org, because global accounts and cross-org membership need a shared identity layer.
- Putting all tenant data in Durable Objects, because identity and membership need relational queries.
- One shared live object for every org, because it would weaken isolation and create a global coordination bottleneck.
