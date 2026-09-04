# D17: Keep two products on one main branch

Revised 4 September 2026.

## Decision

Local Remy stays a complete, free product on `main`. Hub mode is a setting, and the Remy for Teams hub lives under `hub/`. The app and hub communicate through a versioned contract because they can ship on different days.

The `local-remy` name is a tag on the final local-only release, not a branch.

## Consequences

The DMG keeps shipping from `main`. The installed daemon is also the computer binary, including when it runs headless inside a Sprite. Hub work cannot make local mode depend on the hosted service.

## Rejected alternatives

- Branching local Remy away from `main` and retiring its release train.
- Replacing local Remy with the hosted product.
- Maintaining separate repositories or computer implementations for Macs and Sprites.
- An unversioned app-to-hub protocol that assumes both products update together.
