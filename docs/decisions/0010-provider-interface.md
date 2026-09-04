# D10: Put Claude Code and Codex behind one provider interface

## Decision

Claude Code and Codex ship from day one behind a formal provider adapter extracted from the daemon. Cursor remains behind the same interface.

## Consequences

No code outside adapters names a provider SDK. A new provider is one adapter and must pass the common suite.

## Rejected alternatives

- Calling provider SDKs throughout the daemon, because hub execution would multiply provider-specific paths.
- Shipping only Claude Code first, because Codex is a launch provider.
- Replacing Cursor's ACP implementation with a special-case protocol.
