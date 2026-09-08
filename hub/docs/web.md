# Hosted web application

Cloudflare serves the same Vite output that Electron packages. `/api/runtime` selects hosted mode before the window asks for local data. Electron and a local proxy remain local by default. Relative assets still work with `file://`; invitation links use the root URL, and legacy `/invite/:token` paths redirect there before serving the app.

Hosted requests carry the organization in their URL and the web session in an HTTP-only, same-origin cookie. No computer or daemon bearer credential reaches the page. Magic links and social/SSO callbacks exchange the temporary Better Auth session for a revocable Remy session. The original invitation survives sign-in. Email invitations are delivered through the configured email queue; link invitations are returned only when no email recipient is supplied.

| Path | Behavior |
| --- | --- |
| Owner | D1 owns organizations, memberships, teams, and workspace restrictions; the organization Durable Object owns Tasks. |
| Read | Every list/detail checks current membership and workspace access. Imported workspace records remain organization-visible unless they have a restricted workspace registration. |
| Write | Member identity is assigned by the hub. Current access and any new workspace destination are checked before appending. |
| Live | Board and organization sockets send content-free resets. Open views read authorized state again; membership/session expiry closes the socket. |
| Reconnect | Lists refresh on connection/reset; transient failures retain an explicitly stale view. |
| Navigation | Hash routes preserve the selected organization. The last organization is remembered per account. Threads remain in the sidebar while other sections are open. |
| Sign-out | Only the current session is revoked, its cookie expires, and the organization view is cleared. |

The web UI exposes sign-in methods configured by the deployment. Real Google/GitHub/SSO round trips require those providers' credentials and domain setup. Tests exercise production magic-link handling with captured email delivery; they do not pretend to complete an external OAuth provider flow.

## Build and verify

`npm run build --prefix web` builds both modes. Hub CI builds it before validation; `hub/scripts/deploy.ts` builds it before applying migrations or deploying. A deployment serves the static assets and API from one origin.

For isolated hosted QA, build the web and computer, then run `QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs`. This uses the production asset handler, hub, computer, and authentication implementation. Only provider responses, email delivery, and the QA secret-store binding are disposable adapters. The printed session file stays local and must not be uploaded.

```sh
QA_SESSION=<printed session file> node web/scripts/qa-hub-web.mjs
```

The test signs in two people, creates an organization, delivers and accepts an invitation, edits shared Tasks, restricts a workspace, grants and revokes team access live, changes roles, reloads deep links, switches organizations, and checks a narrow viewport. Capture authorization and invitation setup outside any reviewer recording.

References: [Cloudflare asset routing](https://developers.cloudflare.com/workers/static-assets/binding/), [Better Auth sign-in](https://better-auth.com/docs/basic-usage), [SSO](https://better-auth.com/docs/plugins/sso).
