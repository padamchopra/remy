# D16: Support four agent scopes

## Decision

Agents can belong to an org, team, workspace, or person from launch. A personal agent is visible only to its owner and can be promoted outward.

## Consequences

Scope and owning id are durable agent fields. Visibility, conversations, memories, promotion, deletion, and member departure follow that ownership.

## Rejected alternatives

- A single org-wide agent namespace.
- Deferring personal or team scope, because later promotion and visibility would require migrating ownership.
- Copying an agent during promotion, because its conversations and memories must carry forward.
