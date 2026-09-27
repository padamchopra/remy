# Hosted web application

Cloudflare serves the web app, the only Remy client, beside its API. `/api/runtime` reports hosted mode before the app starts; without it the page says Remy isn't responding and offers another try. There is no local mode that talks to a daemon's `/api`. Invitation links use the root URL, and legacy `/invite/:token` paths redirect there before serving the app.

Hosted requests carry the organization in their URL and the web session in an HTTP-only, same-origin cookie. No computer or daemon bearer credential reaches the page. Magic links and social/SSO callbacks exchange the temporary Better Auth session for a revocable Remy session. The original invitation survives sign-in. Account emails and invitations are delivered through the native `EMAIL` binding and `EMAIL_FROM` sender, with the `EMAILS` queue supported for other deployments; link invitations are returned only when no email recipient is supplied.

| Path | Behavior |
| --- | --- |
| Owner | D1 owns organizations, memberships, teams, and workspaces; the organization Durable Object owns thread snapshots and live streams. |
| Read | Every list/detail checks current membership. Every member reaches every workspace in the organization; there is no per-workspace restriction (migration 0036 cleared the old ones and dropped their grant tables). Only owners and admins rename, re-icon or remove a workspace. |
| Write | Member identity is assigned by the hub. Current access and any new workspace destination are checked before the request reaches a computer. |
| Live | Organization sockets send content-free resets. Open views read authorized state again; membership/session expiry closes the socket. |
| Reconnect | Lists refresh on connection/reset; transient failures retain an explicitly stale view. |
| Navigation | Clean paths reload through the app-shell fallback. All is the default account view with no query parameter; a narrower account writes `organization` explicitly. Legacy hash links and `organization=all` normalize on open. Threads remain in the sidebar while other sections are open. |
| Sign-out | Only the current session is revoked, its cookie expires, and the organization view is cleared. |

The web UI exposes sign-in methods configured by the deployment. Google and GitHub do not ask for an email first; SSO reveals its own work-email form. Email and password create an account or sign in to one. A magic link still creates an account or resumes one without a password. Invitation preview requires a signed-in account and the same valid, unexpired, recipient-matching token as acceptance; acceptance revalidates it. New accounts and organizations open Threads with workspace and computer setup actions. A first request creates the thread and sends its initial message; a failed send can retry on the created thread. The composer stays available without an online computer so configured cloud execution can allocate one. Real Google/GitHub/SSO round trips require those providers' credentials and domain setup. Tests exercise production magic-link handling with captured email delivery; they do not pretend to complete an external OAuth provider flow.

## Email signup and delivery

Personal accounts can sign up or sign in with an email and password, or with an email link, without Google, GitHub, or SSO. Choose **Create your account**, then **Create account**. That password signs you in. A magic link still creates a verified account when a new person follows it; existing people resume their account. Links expire after five minutes and work once. There is no password-reset form. Verified organization domains that enforce SSO still require their own provider.

Production uses Cloudflare Email Sending with `EMAIL_FROM=no-reply@tryremy.dev` and an `EMAIL` send binding restricted to that sender. Onboard `tryremy.dev` with `wrangler email sending enable tryremy.dev`, then check `wrangler email sending settings tryremy.dev` and `wrangler email sending dns get tryremy.dev`. Email Sending must support arbitrary recipients; destination restrictions are unsuitable for public signup. The native binding is awaited before the form confirms the email was sent, and provider failures are returned without their raw payload.

After deployment, check `/api/runtime` reports `auth.magicLink: true` and `auth.password: true`, then use a fresh browser to create an account with **Create your account** and sign in again with that password. A magic-link signup still needs a real inbox. Local QA captures the composed email at the native binding boundary; it proves the auth flow but not external delivery. Never publish sign-in URLs or captured mail as reviewer evidence.

## Build and verify

`npm run build:hub --prefix web` assembles the public website and hosted app. Web CI builds it before validation; `hub/scripts/deploy.ts` builds it before applying migrations or deploying. A deployment serves the static assets and API from one origin. CI runs `web/scripts/hosted-runtime-check.mjs` against the built app with controlled API responses: fresh and saved local state, personal and organization accounts, desktop and touch phone viewports, deep-link reloads, cloud availability retry, and sidebar notifications. This client regression does not replace authentication and backend integration QA. Agent-driven checks of hosted start, organizations, computers, or providers use the production account in `REMY_QA_EMAIL` and `REMY_QA_PASSWORD` against `dev:hosted` or `app.tryremy.dev`. Fixture hub sessions are not that account. Missing secrets fail with `set REMY_QA_EMAIL and REMY_QA_PASSWORD`. Never commit those values, log the password, or put them in fixtures, website sample state, or PR bodies. Run `npm run qa:hosted` after `npm run dev:hosted` with the secrets in both processes, or set `QA_HOSTED_URL`.

For isolated hosted QA, build the computer with `npm run build --prefix server` and the web app in its deployed layout with `npm run build --prefix web && npm run build:website --prefix web && node web/scripts/assemble-hub.mjs`, then run `QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs`. The hub serves the app at its printed address, and the attached computer is the current `server/dist` with temporary state. This uses the production asset handler, hub, computer, and authentication implementation. Only provider responses, email delivery, and the QA secret-store binding are disposable adapters. The printed session file stays local and must not be uploaded. Run `QA_SESSION=<printed session file> node web/scripts/qa-hub-onboarding.mjs` for fresh-account setup, sign-in form behavior, invitation preview and first-request retry checks.

```sh
QA_SESSION=<printed session file> node web/scripts/qa-hub-web.mjs
```

The test signs in two people, creates an organization, delivers and accepts an invitation, checks that a member sees the organization's workspace, creates a team, changes roles, reloads deep links, switches organizations, and checks a narrow viewport. Capture authorization and invitation setup outside any reviewer recording.

`QA_SESSION=<file> QA_WEB_URL=<hub URL> node web/scripts/qa-workspace-environment.mjs` drives a workspace's environment: the empty state, the Add values dialog with a pasted `.env`, secrets that never reach a browser, Ada's and Grace's views, the struck-through Personal value, removal, and a phone width. It then starts a fixture thread for each of them and asks which values reached it (the fixture answers "Which values reach this thread: KEY=? KEY" with values for `=?` keys and only set or not set for the rest), proving Workspace values reach both, Ada's Personal secret reaches only hers, and a removed value leaves the next turn. Screenshots land in `/tmp/remy-pr-artifacts/workspace-environments`.

### Real GitHub, Linear and models

Pull requests, reviews and the review agent are verified on this same disposable hub, against a sandbox repository and a real model, not on production and not against fixtures. Every variable is optional; with none set the hub behaves as above. They need `QA_HUB_WEB=1`. `qa-threads.mjs` reads `hub/.qa.env` (`KEY=VALUE` lines, git-ignored) first, and a variable already in the environment wins. `QA_ENV_FILE=<path>` reads another file, and `QA_ENV_FILE=0` skips it for a fixture-only run such as `qa-hub-threads.mjs`, which expects the fixture workspace.

| Variable | Effect |
| --- | --- |
| `QA_GITHUB_REPOSITORY` | `owner/name` of a disposable sandbox. The QA workspace is a real clone of it, named after the repository, with `https://github.com/<repo>.git` as its origin, and the organization gets the matching workspace record, as adding it under Workspaces does, so pull request lists and review starts find it. Requires `QA_GITHUB_TOKEN`. |
| `QA_GITHUB_TOKEN` | Ada's GitHub connection, stored through the same personal access token path as Connections (`Connections.personalToken`, encrypted in `connections`), so every `github/*` route and the review agent use it. It also clones the sandbox and seeds the pull request. |
| `QA_GITHUB_SEED` | `0` skips seeding. Otherwise, when the sandbox has no open pull request, the hub opens one from `qa/<timestamp>` that swaps one word in `qa/review-sample.md` and adds a few lines. The first run commits that file to the default branch, or to a `qa/sample-base` branch the pull request targets when the default branch refuses a direct commit. Open pull requests print as `QA_GITHUB_PULL_REQUEST=<url>`. |
| `QA_GITHUB_REVIEWER_TOKEN` | Grace's GitHub connection. She is a member of the QA organization, so she can open the workspace and approve or request changes on Ada's pull request. Use a second GitHub account with access to the sandbox; GitHub refuses an author's own approval. |
| `QA_LINEAR_TOKEN` | Ada's Linear account, saved and linked to Ada in the QA organization as the Linear OAuth callback does (`linear_accounts`, `member_linear_links`), for the linked ticket chip. The hub sends it as `Authorization: Bearer`, as it does an OAuth token. |
| `QA_REAL_PROVIDERS=1` | The computer runs the providers installed and signed in on this Mac — Claude Code with its own `~/.claude` sign-in (or `ANTHROPIC_API_KEY` when set), Codex and Cursor — instead of the fixture model. `HOME` and `PATH` pass through; `MC_*` and `REMY_*` are still stripped, and so are a surrounding Claude Code session's own variables (`CLAUDECODE`, `CLAUDE_CODE_*`, and its `ANTHROPIC_BASE_URL`), so a run started from an agent uses this Mac's sign-in rather than the agent's. State still lives in the temporary `MC_CONFIG_DIR`. Turns cost real usage; agent-driven QA keeps the fixture model. |

Token scopes: a classic token with `repo` works for both GitHub accounts (`public_repo` for a public sandbox); add `read:org` when the sandbox belongs to an organization, for reviewer suggestions. A fine-grained token needs Metadata read, Contents read and write, Pull requests read and write, Issues read and write, and Checks and Commit statuses read on the sandbox; the reviewer needs Pull requests read and write. When `QA_CONNECTIONS=1` is also set, the disposable OAuth provider still answers for any vendor without a real token.

```sh
cat > hub/.qa.env <<'EOF'
QA_GITHUB_REPOSITORY=you/remy-qa-sandbox
QA_GITHUB_TOKEN=...
QA_GITHUB_REVIEWER_TOKEN=...
EOF
QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs
```

Tokens never appear in argv, a URL, a log or the session file; the script refuses to write a session file that contains one, which lists only the connected account names (`connected`) and the sandbox's pull requests (`github`). Seeding goes through a loopback-only `POST /__qa/connections` that exists only when a real token is set and requires a random per-run header. Git reaches the sandbox through a credential helper in the temporary directory that reads a `0600` token file; the clone's local config resets every other helper for it, so the token never reaches your keychain or `gh`, and the computer's later fetches of a review's pull request ref use it too. A real provider working in that clone can read that file, as it could any computer's own Git login, so keep the tokens scoped to the sandbox. Stopping the script, or a failed start, removes the directory and the token file with it.

With the fixture model, a review thread still goes through the real tools (`hub/scripts/qa-review-fixture.mjs`): its start message and each Review new changes make the fixture run `git diff --unified=0 origin/<base>...HEAD` in the review's worktree and report one `should` finding on the first added line through `report_review_findings`, so the hub's diff check, the findings beside the diff and Add to GitHub review can be checked. A flag message makes it call `propose_review_rule` with that finding's id. Anything else gets a plain reply.

Webhooks are not replayed. The hub acts on a GitHub delivery only for a GitHub App installation, which a personal access token has none of, and Activity and its badge read GitHub's timeline directly, so new comments and reviews show on the next read without one.

`node --test hub/scripts/qa-github.test.mjs` covers `.qa.env` parsing, input checks, the credential helper, the pull request seed and the review fixture's diff anchor without the network.

References: [Cloudflare asset routing](https://developers.cloudflare.com/workers/static-assets/binding/), [Better Auth sign-in](https://better-auth.com/docs/basic-usage), [SSO](https://better-auth.com/docs/plugins/sso).

## Local hosted UI with a live account

Run `npm run dev:hosted` and open `http://127.0.0.1:5174`. It is the only browser dev shell; the local shell that pointed the UI at this machine's daemon was removed. When `REMY_QA_EMAIL` and `REMY_QA_PASSWORD` are set in that Vite process, choose **Sign in**; the preview uses production email/password and keeps that session. Otherwise choose **Sign in with Remy**, open **Approve in Remy**, compare the code, and approve it using your live account, then **Finish signing in**. This is live account data: actions persist in production.

The preview keeps access credentials in the Vite process memory, never in browser storage or URLs. Password secrets stay in the environment; the page never receives them on the preview password path. Stopping Vite forgets them; signing out revokes the session. Device-code approval is named **Remy local web preview**. OAuth and email sign-in stay on the production origin.

`PREVIEW_ORIGINS` is an exact comma-separated allowlist for bearer-authenticated preview requests, including live connections. Production currently permits only `http://127.0.0.1:5174`. The preview binds `127.0.0.1` and redirects a page opened on `localhost` to that origin, so the allowlist stays exact. Cookie authentication and OAuth trusted origins are unchanged. The loopback preview rejects foreign Origin, Host, and cross-site Fetch Metadata headers before attaching credentials. It forwards the browser Origin unchanged. Never expose this preview on a network interface or reuse a production browser cookie in it.

Thread submission opens its permanent thread URL immediately. The hub stores the complete start and first message before the computer starts. Reloading or reopening the URL resumes the same durable start, and Retry keeps the same thread, computer, and message identities. The current browser keeps a one-day display cache, but the hub owns progress and resumes it through status reads and its alarm.

Organization thread launches choose Shared or Private visibility in the composer. An automatic computer choice and an explicit one both default to Shared only when they resolve to a Personal computer shared with that organization; every other launch defaults to Private. The person starting the thread can override that default before sending and change it later.

Cloud checkout supports repositories imported with GitHub OAuth or a personal access token. Each cloud task uses the initiating member’s connection after checking current workspace access. GitHub credentials remain in the hub; computers receive only short-lived capabilities limited to their assigned repository and allowed branches. Existing GitHub App installations remain supported.

General settings hold your avatar and notification preference. Your avatar belongs to your signed-in account; presets and resized raster pictures use the existing profile image field. Changes notify your open organization sessions and reload after reconnect. Browser notification permission remains local to each browser. Web updates ship automatically; the app information row links to the setup guide for installing Remy on a computer.

There is no account-wide default model or permission. A new thread takes its model from the composer: your pick for that workspace, else your default for the chosen computer (Computers), else the first model the computer or cloud offers. A workspace has no default model of its own; migration 0036 drops `member_workspace_model_defaults`. Every new thread starts on Ask; a person can change the permission once the thread exists. Migration 0031 drops the old `member_model_defaults` and `member_preferences` tables, and `GET /profile-preferences` is gone; `PATCH /model-defaults` requires a `computer` query. Existing threads retain their permission levels.
