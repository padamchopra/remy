# Connections

WRK-21 and WRK-133–136 provide the shared connection broker. Settings → Connections is one account-wide list grouped by provider. A member connects and disconnects only their own identity. Each connection is available either to every organization through Personal or only to one selected organization. An organization-specific connection overrides the Personal fallback without copying its credential. Workspace behavior belongs to the later integration's workspace policy, rather than a second copy of its credential.

Apply migration 0012. The hub uses its existing JOBS queue and scheduled trigger. Register provider client IDs as variables and client secrets/webhook secrets through Secret Store bindings:

- GitHub App user authorization: GITHUB_CONNECTION_CLIENT_ID and GITHUB_CONNECTION_CLIENT_SECRET; GITHUB_WEBHOOK_SECRET for deliveries. When these are absent, the repository picker reuses GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET from sign-in, with explicit repo consent and a separately validated connection state on the existing callback.
- Linear: LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET. Linear has no webhook. Without these bindings, Connect Linear accepts the person's own API key instead of asking an organization administrator to enable it.
- Callback: `https://<hub>/api/connections/<provider>/callback`.
- Webhook, for GitHub only: `https://<hub>/api/connections/github/webhook`.

Provider definitions live in connection-providers.ts. Adding a provider supplies its endpoints, scopes and verified identity lookup, plus signature validation and a delivery handler when it sends webhooks. This framework alone does not import repositories.

Credentials and PKCE verifiers are encrypted using AUTH_SECRET-derived AES-GCM keys with organization/provider/record context. Public reads return identity labels and connection state, never credentials. State is single-use, expires after ten minutes and is bound to the signed-in member. A disconnect advances an epoch so an already-running callback cannot reconnect it. Member departure removes the member credential. Organization credentials survive their original installer's departure and disappear with the organization.

Linear keeps each person's sign-in, and a second workspace adds a row instead of replacing the first. Each person chooses their own Linear workspace for each organization. A Personal choice is their fallback for organizations without their own choice. Another member cannot see, use, or change that choice. Leaving removes only that person's link, and disconnecting an account removes only links owned by that person.

Refresh uses a D1 lease and generation check. A failed refresh asks the owner to reconnect. Signed webhook bodies are bounded to 1 MB, persist before acknowledgement and are deduplicated by both provider delivery ID and signed-body digest. The queue contains only a receipt ID. A coordinator serializes a receipt's processing; handlers must additionally use stable operation IDs for external writes that can succeed before a process restart. Pending receipts are requeued every five minutes after queue retries are exhausted. Connection changes notify open settings; reconnect reloads authoritative state.

The QA provider runs only in the separate test fixture. It replaces vendor OAuth endpoints while exercising the production broker, PKCE exchange, encrypted storage, current-member checks and live settings. Vendor consent and refresh still require configured OAuth applications; no live vendor result is claimed by that fixture.

Provider references: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).


Workspace setup offers GitHub account authorization or a personal access token, followed by a paginated repository picker. Tokens are validated against GitHub and kept in the existing encrypted member connection; the picker never reads them back. Import rechecks repository access and reuses an existing canonical workspace without replacing other selections. A PAT connection does not configure GitHub App installations or webhooks; hosted Git still requires its existing installation setup.

### Workspace images

In workspace details, the icon picker can search PNG, JPEG, SVG, and WebP images in the GitHub repository’s default branch. Images must be smaller than 1 MB. The hosted app uses your connected GitHub account and checks your workspace access before reading files. The selected repository path is saved with the workspace; local uncommitted files are not available through GitHub.
