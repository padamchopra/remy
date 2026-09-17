# Hosted web application

Cloudflare serves the same Vite output that Electron packages. `/api/runtime` selects hosted mode before the window asks for local data. Electron and a local proxy remain local by default. Relative assets still work with `file://`; invitation links use the root URL, and legacy `/invite/:token` paths redirect there before serving the app.

Hosted requests carry the organization in their URL and the web session in an HTTP-only, same-origin cookie. No computer or daemon bearer credential reaches the page. Magic links and social/SSO callbacks exchange the temporary Better Auth session for a revocable Remy session. The original invitation survives sign-in. Account emails and invitations are delivered through the native `EMAIL` binding and `EMAIL_FROM` sender, with the `EMAILS` queue supported for other deployments; link invitations are returned only when no email recipient is supplied.

| Path | Behavior |
| --- | --- |
| Owner | D1 owns organizations, memberships, teams, and workspace restrictions; the organization Durable Object owns Tasks. |
| Read | Every list/detail checks current membership and workspace access. Imported workspace records remain organization-visible unless they have a restricted workspace registration. |
| Write | Member identity is assigned by the hub. Current access and any new workspace destination are checked before appending. |
| Live | Board and organization sockets send content-free resets. Open views read authorized state again; membership/session expiry closes the socket. |
| Reconnect | Lists refresh on connection/reset; transient failures retain an explicitly stale view. |
| Navigation | Clean paths reload through the app-shell fallback. All is the default account view with no query parameter; a narrower account writes `organization` explicitly. Legacy hash links and `organization=all` normalize on open. Threads remain in the sidebar while other sections are open. |
| Sign-out | Only the current session is revoked, its cookie expires, and the organization view is cleared. |

The web UI exposes sign-in methods configured by the deployment. Google and GitHub do not ask for an email first; SSO reveals its own work-email form. Invitation preview requires a signed-in account and the same valid, unexpired, recipient-matching token as acceptance; acceptance revalidates it. New accounts and organizations open Threads with workspace and computer setup actions. A first request creates the thread and sends its initial message; a failed send can retry on the created thread. The composer stays available without an online computer so configured cloud execution can allocate one. Real Google/GitHub/SSO round trips require those providers' credentials and domain setup. Tests exercise production magic-link handling with captured email delivery; they do not pretend to complete an external OAuth provider flow.

## Email signup and delivery

Personal accounts can sign up or sign in with an email link without Google, GitHub, or SSO. Better Auth creates a verified account when a new person follows the link; existing people resume their account. Links expire after five minutes and work once. Verified organization domains that enforce SSO still require their own provider.

Production uses Cloudflare Email Sending with `EMAIL_FROM=no-reply@tryremy.dev` and an `EMAIL` send binding restricted to that sender. Onboard `tryremy.dev` with `wrangler email sending enable tryremy.dev`, then check `wrangler email sending settings tryremy.dev` and `wrangler email sending dns get tryremy.dev`. Email Sending must support arbitrary recipients; destination restrictions are unsuitable for public signup. The native binding is awaited before the form confirms the email was sent, and provider failures are returned without their raw payload.

After deployment, check `/api/runtime` reports `auth.magicLink: true`, then use a fresh browser and a real inbox to complete signup and sign in again. Local QA captures the composed email at the native binding boundary; it proves the auth flow but not external delivery. Never publish sign-in URLs or captured mail as reviewer evidence.

## Build and verify

`npm run build:hub --prefix web` assembles the public website and hosted app. Hub CI builds it before validation; `hub/scripts/deploy.ts` builds it before applying migrations or deploying. A deployment serves the static assets and API from one origin. CI runs `web/scripts/hosted-runtime-check.mjs` against the built app with controlled API responses: fresh and saved local state, personal and organization accounts, desktop and touch phone viewports, deep-link reloads, cloud availability retry, and sidebar notifications. This client regression does not replace authentication and backend integration QA.

For isolated hosted QA, build the web and computer, then run `QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs`. This uses the production asset handler, hub, computer, and authentication implementation. Only provider responses, email delivery, and the QA secret-store binding are disposable adapters. The printed session file stays local and must not be uploaded. Run `QA_SESSION=<printed session file> node web/scripts/qa-hub-onboarding.mjs` for fresh-account setup, sign-in form behavior, invitation preview and first-request retry checks. The browser approval link from Attach this Mac preserves its code through sign-in; after explicit approval, return to the Mac, choose an account by name, and finish connecting. Account discovery uses the approved native credential inside the daemon; the renderer receives account names and roles, never that credential.

```sh
QA_SESSION=<printed session file> node web/scripts/qa-hub-web.mjs
```

The test signs in two people, creates an organization, delivers and accepts an invitation, edits shared Tasks, restricts a workspace, grants and revokes team access live, changes roles, reloads deep links, switches organizations, and checks a narrow viewport. Capture authorization and invitation setup outside any reviewer recording.

References: [Cloudflare asset routing](https://developers.cloudflare.com/workers/static-assets/binding/), [Better Auth sign-in](https://better-auth.com/docs/basic-usage), [SSO](https://better-auth.com/docs/plugins/sso).

## Local hosted UI with a live account

Run `npm run dev:hosted` and open `http://127.0.0.1:5174`. Choose **Sign in with Remy**, open **Approve in Remy**, compare the code, and approve it using your live account. Return to the preview and choose **Finish signing in**. This is live account data: actions persist in production.

The preview uses the existing device-code authorization flow. Its access and refresh credentials stay in the Vite process memory, never in browser storage or URLs. Stopping Vite forgets them; signing out revokes the session. The session is named **Remy local web preview**. OAuth and email sign-in stay on the production origin.

`PREVIEW_ORIGINS` is an exact comma-separated allowlist for bearer-authenticated preview requests, including live connections. Production currently permits only `http://127.0.0.1:5174`. Cookie authentication and OAuth trusted origins are unchanged. The loopback preview rejects foreign Origin, Host, and cross-site Fetch Metadata headers before attaching credentials. It forwards the browser Origin unchanged. Never expose this preview on a network interface or reuse a production browser cookie in it.

Thread submission opens a pending thread immediately. The first message stays visible while the computer starts. Startup and sending failures can be retried in place using the same request and message IDs. Pending starts survive refresh in the current browser tab for up to one day; they are scoped to the signed-in member and organization.

Organization thread launches choose Shared or Private visibility in the composer. Automatic routing and explicit computer choices default to Shared only when they resolve to a Personal computer shared with that organization; every other launch defaults to Private. The person starting the thread can override that default before sending and change it later.

Cloud checkout supports repositories imported with GitHub OAuth or a personal access token. Each cloud task uses the initiating member’s connection after checking current workspace access. GitHub credentials remain in the hub; computers receive only short-lived capabilities limited to their assigned repository and allowed branches. Existing GitHub App installations remain supported.

General settings reuse the Mac avatar picker, notification preference, appearance row, and permission selector. Your avatar belongs to your signed-in account; presets and resized raster pictures use the existing profile image field. Changes notify your open organization sessions and reload after reconnect. Browser notification permission remains local to each browser. Web updates ship automatically; the app information row links to the Mac download instead of offering an in-app installer.

Account permission defaults require migration 0023 and a computer package with the updated hosted thread creation handler. Existing threads retain their permission levels. No saved preference means Ask.
