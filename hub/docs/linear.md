# Linear connection

Configure the organization OAuth app and webhook secret described in `connections.md`. In the Linear OAuth app settings, enable issue, comment, user, label and grouping webhooks at `/api/connections/linear/webhook`. The broker acknowledges accepted Linear deliveries with HTTP 200, as required by Linear. The app's organization identity determines the recipient; a payload cannot choose a Remy organization.

You connect your own Linear account in Settings → Connections. Each Linear workspace is its own row. Settings → Organization ties this organization to one of your workspaces, or to none. Personal can hold the same kind of link. Another member's accounts are not listed, and an administrator does not connect Linear for everyone.

A thread starts even when Linear is not connected. When this organization has a Linear workspace and you have a sign-in for it, the thread uses Linear's hosted MCP with your token. If the sign-in is missing or needs reconnect, the thread says so. Team mapping does not gate that access.

An administrator can still refresh teams and map a team or a grouping to a Remy workspace. That refresh uses the acting member's sign-in. An optional Remy team is a mapping, not an implicit grant of workspace access. Existing workspace restrictions remain authoritative. Every Linear state must map to a Remy column. Unknown people retain their names; email matches are suggestions that an administrator confirms. Email addresses and tokens do not appear in the connection response.

The full catalog is administrator-only. Other members cannot enumerate private Linear teams or people. Paginated lists are fetched completely before replacing the catalog, and a failed refresh preserves the previous catalog. Mappings follow the organization's Linear workspace. Leaving removes your sign-in from the organization. Sync continues only while some remaining member still has that workspace; it does not keep a shared organization token.

Verified issue, comment and state-bearing issue updates enter a durable inbox. WRK-24 consumes that inbox for ticket mirroring. OAuth revocation prompts reconnection. The connection page updates through the organization's live stream and replaces cached state on reconnect.

QA uses a disposable provider through the production broker, catalog service, database, signature verification and queue. A live acceptance run requires a configured Linear OAuth app and an authorized disposable team.

Sources: [Linear GraphQL](https://linear.app/developers/graphql), [webhooks](https://linear.app/developers/webhooks), [official schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).

## Ticket sync

After mapping, an administrator turns sync on separately for each workspace. The initial import keeps the Linear team’s ticket slug and numbers. Existing Remy tickets become Linear issues; parent tickets become parent issues. Title, description, column, member or agent assignment, labels, and parent relationships mirror both ways. Resolve `Work on ENG-123` in a workspace thread before sending the linked issue to its provider.

Each field keeps a timestamp; the later write wins, with Linear winning exact ties. Comments append once. Signed inbound updates retain their source, and outbound comments and issue creation use durable UUIDs supported by the Linear schema. Lost responses are reconciled by those IDs before retrying. This prevents echoed comments and retries from becoming new work. A failed outbound item stays in a durable retry queue while other items can proceed.

An administrator can explicitly map a Linear assignee to a shared Remy agent. Automatic work starts only when the assigning Linear actor matches a current Remy member with workspace access. The thread uses that member’s routing and access, is open to the workspace, and sends comments and its final response back with thread and artifact links. An uncertain thread-start response is surfaced for inspection rather than automatically starting a second thread.

Turning sync off deletes nothing in either app and pauses new mirror writes. Re-enabling imports the current Linear state and resumes retained mirror work. Disconnecting Linear or changing its external account stops the old account’s sync; its existing tickets remain. A new unmapped Linear state pauses the affected update until an administrator updates the column mapping.

The automated mirror check applies 50 rapid edits and comments, loses one comment response, and replays vendor echoes: the final title converges and all 50 comments appear exactly once. Browser QA exercises the real hub, signature verification, durable queue, board stream, connected computer and provider tools against disposable Linear and model endpoints. It does not substitute for a live OAuth acceptance run.
