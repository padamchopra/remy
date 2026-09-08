# Built-in organization agents

WRK-19 and WRK-125–129 seed an organization coordinator and one private Remy per membership. The coordinator starts with the organization's name and may be renamed by an administrator. Identity, role and instructions are otherwise release-owned; clients cannot delete either built-in or override those fields. Rejoining receives a new personal agent rather than reviving a deleted conversation.

Each message starts a computer-owned run with that member's authority fixed in a hub-created binding. Team conversations cannot borrow the previous speaker's administrator permissions. The hub checks current membership, agent visibility, workspace access and computer policy for every tool call. Persona instructions are stored per run on its computer, outside the local shared agent roster.

The coordinator can inspect eligible computers and visible load, read/edit routing, explain selection and continue a thread elsewhere. Personal Remy can list visible workspaces, create tickets, hand off to visible agents and start work across workspaces. Both MCP paths expose the same exact allowlisted operations and artifact markers. Moving creates a continuation with readable transcript context, then stops the source; it does not transfer uncommitted files or provider sessions.

Execution uses the first visible workspace (or the agent's owning workspace) and the routing resolver. A configured eligible computer and at least one workspace are required. Model choice inherits computer defaults unless the agent has one. Responses return to the hub conversation; startup failure is explicit. Hub-owned routine scheduling and a run index follow in WRK-20.

Validation uses a disposable model adapter with the real in-process MCP server and hub/computer identity path. No paid model's interpretation of the prompt is claimed by that fixture. Live hosted model verification remains a WRK-15 rollout gate.
