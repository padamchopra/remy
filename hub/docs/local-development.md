# Local development

`npm run dev:local` runs this checkout’s web app on 5175, hub on 5184, connected computer on 8421, and cloud startup service on 5186. Backend edits require restarting the command; frontend edits require refreshing the page. Ordinary app changes do not require a production deployment.

The local hub reuses your production profile, account scopes, workspace metadata, and Personal cloud/model connections. Production owns credential refresh. GitHub reads and Git fetches go through the approved connection bridge, which keeps GitHub credentials on production. Personal cloud/model keys reach the local backend only in memory; ChatGPT delivers short-lived access tokens and never copies refresh tokens. Workspace/Personal environment values and Linear execution access are fetched for each turn. Local code can read execution credentials: this is a trusted development setup, not a sandbox against that code. Management responses expose names and configured state only.

Threads, review rules, findings, cloud registrations, database objects, and coordination state stay local, under the git-ignored `.wrangler/remy-local` directory. No production thread is created to test local execution. GitHub mutations are refused in the local preview; use Remy for posting or merging. The bridge currently reuses your own Personal cloud/model keys, not another member’s enrolled keys.

## One-time setup

Keep the hosted preview signed in, then run `npm run dev:local -- --connect-account`. Approve the printed development computer code in Remy. The dedicated identity lives in `~/.remy/development/bridge/computer/remy.db` and is reused across checkouts. A legacy checkout identity is migrated there without replacing an existing shared identity. The existing computer on 8420 and its registration remain untouched.

Deploy the connection bridge once, including migration `0041_development_computers.sql`, then run `npm run dev:local -- --enable-account` with the Cloudflare CLI signed in. This adds only that explicitly approved personal computer to `development_computers`; it preserves the existing `DEVELOPMENT_COMPUTER_IDS` allowlist. `npm run dev:local -- --bridge-status` verifies account access. Delete the development computer in production or remove its approval row to revoke access. Every bridge call checks the current signed registration, owner, approval, and relevant account/workspace access.

Install `cloudflared` for cloud testing. The launcher starts a temporary HTTPS tunnel to the authenticated local hub so cloud computers can connect out. It exposes neither the connected computer nor the cloud management service. The archive endpoint serves only compiled code and dependency manifests; it contains no local database, settings, or credentials. All other hub routes retain their normal authentication and origin checks.

## Run the preview

Run `npm run dev:local`, then open `http://127.0.0.1:5175`. The approved account signs in automatically. Use your existing Fly.io and model access in the computer/model pickers. The cloud computer installs this checkout’s compiled computer and contract over the release’s Linux dependencies; dependency changes are installed on the cloud computer. Restarting local services rebuilds that archive, and cloud startup reloads it.

If the shared browser is on another Mac, run `npm run dev:local -- --browser-computer macbook`, using its configured SSH host in place of `macbook`. The preview is forwarded between the computers’ loopback addresses on 5175. Its browser address and allowed origin stay `http://127.0.0.1:5175`. Keep the launcher running for the user.

The hub database, objects, and connected computer state persist across restarts. The local connected computer uses the hub’s loopback address, so it does not depend on tunnel DNS. Cloud threads resume through the local hub and receive its current connection details when they start. The hosted preview on 5174 remains separate.

`npm run dev:local -- --isolated` creates a separate local account without production connections. It is for isolated implementation checks and is not evidence of account reuse. The local email adapter captures mail and sends nothing externally. Vite denies access to `.wrangler`; the captured-mail page accepts loopback requests only.

## Verify

Check the authenticated shell in the shared browser, then exercise the affected journey through a real local thread or review. Verify live output, restart/reconnect, and revocation for connection changes. Installed and cloud providers can incur real usage.

Focused checks: `node --test hub/scripts/local-development.test.mjs hub/scripts/local-production-bridge.test.mjs hub/scripts/local-computer-archive.test.mjs hub/scripts/local-account.test.mjs hub/scripts/local-runtime.test.mjs`, hub tests/typechecking, and runtime adapter tests/typechecking. This development-only setup does not need a public website entry.
