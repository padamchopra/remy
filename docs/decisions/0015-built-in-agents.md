# D15: Seed an org orchestrator and a personal Remy

## Decision

Every org receives an orchestrator named after the org, and every member receives a personal Remy. The orchestrator owns routing and computers; personal Remy works across the member's visible workspaces.

## Consequences

Both agents are protected built-ins with different ownership and tool scopes. Personal Remy is seeded when a member joins.

## Rejected alternatives

- One global built-in agent, because org administration and personal work have different authority.
- Making routing intrinsic to a deletable user-created agent.
- One shared personal assistant conversation for the whole org.
