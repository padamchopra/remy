# D12: Run Android work on org-owned Macs

## Decision

An org-owned Mac can register as a computer, and a routing rule sends Android workspaces to it.

## Consequences

The Android workspace is the reference routing example. Computer capability and availability must account for the hardware-accelerated emulator.

## Rejected alternatives

- Fly Sprites and Modal for Android emulator work, because neither can run the required hardware acceleration.
- Manual computer selection for every Android thread, because the workspace is predictably routable.
