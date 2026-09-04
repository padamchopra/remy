# D8: Give computers an explicit audience

## Decision

A computer is available to only its owner, selected members, or everyone in the org. Personal computers default to only their owner; admin-registered org computers default to everyone. Hosted computers are org computers.

## Consequences

Authorization filters computer lists and routing candidates before a thread can start.

## Rejected alternatives

- Making every connected computer org-wide by default, because a personal Mac must remain private.
- Giving hosted computers a separate policy model, because they are ordinary org computers after registration.
- Relying on routing rules as access control, because selection preference cannot grant permission.
