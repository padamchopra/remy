# D11: Use two visibility defaults with attribution

## Decision

A thread started by hand is private. A thread started by Linear, Slack, a routine, or a webhook is visible to the org and anyone eligible can join. Every message and action is attributed.

## Consequences

Visibility is explicit thread state. Joining, sending, approving, and answering retain member identity through reconnect and replay.

## Rejected alternatives

- Making every thread private, because automation-created work must be joinable.
- Making every thread org-visible, because ad-hoc personal work should stay private.
- Shared transcripts without per-message attribution.
