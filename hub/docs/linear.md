# Linear connection

Configure the Linear OAuth app described in `connections.md`. The hub needs only its client ID and secret, and authorizes each connection with `actor=user`. When that app is not configured, the same Connect Linear action accepts the person's own Linear API key. It has no Linear webhook: Remy does not import, mirror or comment on Linear issues itself.

You connect your own Linear account in Settings → Connections. Each Linear workspace is its own row. Your choice for an organization belongs only to you, and Personal can supply your fallback across organizations. Another member cannot see, use, or change it. An administrator does not connect Linear for everyone.

A thread starts even when Linear is not connected. When this organization has a Linear workspace and you have a sign-in for it, the thread uses Linear's hosted MCP with your token, so the model reads and changes Linear as you. If the sign-in is missing or needs reconnect, the thread says so. A token that no longer refreshes marks the sign-in for reconnect the next time a thread asks for it.

Leaving an organization removes your choice there. Your account stays available anywhere else you chose it. The hub never keeps a shared organization choice or token. Email addresses and tokens do not appear in any connection response.

Sources: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), [Linear MCP](https://linear.app/docs/mcp).
