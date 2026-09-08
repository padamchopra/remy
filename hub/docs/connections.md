# Organization connections

WRK-21 and WRK-133–136 provide the shared connection broker. Settings → Connections belongs to the organization. Organization connections require an administrator; member identities can be connected and disconnected only by that member. Workspace behavior belongs to the later integration's workspace policy, rather than a second copy of its credential.

Apply migration 0012. The hub uses its existing JOBS queue and scheduled trigger. Register provider client IDs as variables and client secrets/webhook secrets through Secret Store bindings:

- GitHub App user authorization: GITHUB_CONNECTION_CLIENT_ID and GITHUB_CONNECTION_CLIENT_SECRET; GITHUB_WEBHOOK_SECRET for deliveries. These are distinct from sign-in credentials.
- Linear: LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET and LINEAR_WEBHOOK_SECRET.
- Callback: `https://<hub>/api/connections/<provider>/callback`.
- Webhook: `https://<hub>/api/connections/<provider>/webhook`.

Provider definitions live in connection-providers.ts. Adding a provider supplies its endpoints, scopes, verified identity lookup, signature validation and delivery handler. Provider-specific setup and behavior arrive in WRK-22 and WRK-23; this framework alone does not import repositories or synchronize tickets.

Credentials and PKCE verifiers are encrypted using AUTH_SECRET-derived AES-GCM keys with organization/provider/record context. Public reads return identity labels and connection state, never credentials. State is single-use, expires after ten minutes and is bound to the signed-in member. A disconnect advances an epoch so an already-running callback cannot reconnect it. Member departure removes the member credential. Organization credentials survive their original installer's departure and disappear with the organization.

Refresh uses a D1 lease and generation check. A failed refresh asks the owner to reconnect. Signed webhook bodies are bounded to 1 MB, persist before acknowledgement and are deduplicated by both provider delivery ID and signed-body digest. The queue contains only a receipt ID. A coordinator serializes a receipt's processing; handlers must additionally use stable operation IDs for external writes that can succeed before a process restart. Pending receipts are requeued every five minutes after queue retries are exhausted. Connection changes notify open settings; reconnect reloads authoritative state.

The QA provider runs only in the separate test fixture. It replaces vendor OAuth endpoints while exercising the production broker, PKCE exchange, encrypted storage, current-member checks and live settings. Vendor consent and refresh still require configured OAuth applications; no live vendor result is claimed by that fixture.

Provider references: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), [Linear webhooks](https://linear.app/developers/webhooks), [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).
