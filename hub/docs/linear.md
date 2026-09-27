# Linear connection

Configure the Linear OAuth app described in `connections.md`. The hub needs only its client ID and secret. It has no Linear webhook: Remy does not import, mirror or comment on Linear issues itself.

You connect your own Linear account in Settings → Connections. Each Linear workspace is its own row. Settings → Organization ties this organization to one of your workspaces, or to none. Personal can hold the same kind of link. Another member's accounts are not listed, and an administrator does not connect Linear for everyone.

A thread starts even when Linear is not connected. When this organization has a Linear workspace and you have a sign-in for it, the thread uses Linear's hosted MCP with your token, so the model reads and changes Linear as you. If the sign-in is missing or needs reconnect, the thread says so. A token that no longer refreshes marks the sign-in for reconnect the next time a thread asks for it.

Leaving an organization removes your sign-in from it. When no remaining member has a sign-in for the organization's Linear workspace, the organization's link is cleared. The hub never keeps a shared organization token. Email addresses and tokens do not appear in any connection response.

Sources: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), [Linear MCP](https://linear.app/docs/mcp).
