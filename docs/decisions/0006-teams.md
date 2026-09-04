# D6: Ship teams as access groups

## Decision

A team is a named set of members available at launch. Workspaces, agents, computers, and routing rules can be restricted to one.

## Consequences

Teams add roughly three weeks to the hub lane and must be part of the authorization model from its first schema.

## Rejected alternatives

- Deferring teams, because retrofitting access groups after tenant data exists would reshape every resource policy.
- Using roles as teams, because administrator capability and resource membership are separate concerns.
