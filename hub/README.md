# Remy for Teams hub

The optional hosted and self-hosted hub lives here. It connects people and Remy computers while local Remy remains a complete product with no hosted dependency.

Platform setup begins in H2. Shared wire shapes belong in `contract/`; local execution remains in `server/`, and the existing clients remain in `web/`, `desktop/`, and `mobile/`.

Hosted computer lifecycle is behind `ComputerRuntimeProvider`. Fly Sprites and Modal are first-class implementations; adding another host does not change the computer protocol. A local Mac does not need a runtime provider at all: it registers with the hub using the same versioned contract after its existing Remy daemon starts.
