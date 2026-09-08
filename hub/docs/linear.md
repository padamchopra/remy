# Linear connection

Configure the organization OAuth app and webhook secret described in `connections.md`. In the Linear OAuth app settings, enable issue, comment, user, label and grouping webhooks at `/api/connections/linear/webhook`. The broker acknowledges accepted Linear deliveries with HTTP 200, as required by Linear. The app's organization identity determines the recipient; a payload cannot choose a Remy organization.

An administrator connects Linear, refreshes its teams and members, then maps a team or a grouping within that team to a Remy workspace. An optional Remy team is a mapping, not an implicit grant of workspace access. Existing workspace restrictions remain authoritative. Every Linear state must map to a Remy column. Unknown people retain their names; email matches are suggestions that an administrator confirms. Email addresses and tokens do not appear in the connection response.

The full catalog is administrator-only. Other members cannot enumerate private Linear teams or people. Paginated lists are fetched completely before replacing the catalog, and a failed refresh preserves the previous catalog. Mappings are bound to the external Linear account; replacing a connection does not carry another account's mappings into the new one. Member departure removes the corresponding match.

Verified issue, comment and state-bearing issue updates enter a durable inbox. WRK-24 consumes that inbox for ticket mirroring. OAuth revocation prompts reconnection. The connection page updates through the organization's live stream and replaces cached state on reconnect.

QA uses a disposable provider through the production broker, catalog service, database, signature verification and queue. A live acceptance run requires a configured Linear OAuth app and an authorized disposable team.

Sources: [Linear GraphQL](https://linear.app/developers/graphql), [webhooks](https://linear.app/developers/webhooks), [official schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).
