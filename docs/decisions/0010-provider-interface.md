# D10: Put model providers behind one interface

## Decision

Claude Code and Codex ship from day one behind a formal model-provider adapter extracted from the daemon. Cursor remains behind the same interface. This interface is separate from the computer runtime interface used for Fly Sprites, Modal, and future infrastructure vendors.

## Consequences

No code outside adapters names a provider SDK. A new provider is one adapter and must pass the common suite.

## Rejected alternatives

- Calling provider SDKs throughout the daemon, because hub execution would multiply provider-specific paths.
- Shipping only Claude Code first, because Codex is a launch provider.
- Replacing Cursor's ACP implementation with a special-case protocol.
