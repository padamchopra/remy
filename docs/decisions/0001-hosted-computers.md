# D1: Host computers on Fly Sprites

## Decision

Hosted Remy computers run on Fly Sprites. They are persistent Linux computers with free idle and sub-second restore.

## Consequences

The H1 spike must prove the Remy daemon, Claude Code, and Codex inside one Sprite, including a real edit and measured checkpoint restore. Modal remains a protocol-compatible fallback.

## Rejected alternatives

- Modal, because its 24-hour lifetime and seven-day snapshot cap would require rebuilding persistence.
- A bespoke virtual-machine platform, because persistence and restore are not product differentiators Remy should build.
