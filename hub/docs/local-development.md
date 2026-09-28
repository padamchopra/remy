# Local development

This setup is in progress. It does not yet provide a shared-account, end-to-end development loop.

`npm run dev:local` builds the current computer code and runs the current hub and web app on loopback. The app uses port 5175, the hub uses 5184, and its computer uses 8421. It does not replace the hosted preview on 5174 or the existing computer on 8420. The hub database, objects, coordination state, and computer registration persist under the git-ignored `.wrangler/remy-local` directory. Vite denies HTTP access to that directory. Restart the command to rebuild backend changes, and refresh the page for frontend changes.

After the one-time bridge deployment, `npm run dev:local` fetches your existing account/workspace metadata, signs in through a private local preview session, and connects the local computer automatically. Its execution connection requests your approved environment and Linear access for each turn. `npm run dev:local -- --isolated` instead starts a separate local account, with no production connection reuse. Do not describe that isolated sign-in screen as proof of production account reuse. The local email adapter captures email only; it sends nothing externally. Installed providers use this computer's existing sign-ins and can incur real usage.

## Production identity

With the hosted preview signed in, run `npm run dev:local -- --connect-account`. It registers a dedicated personal computer named Remy local development, using a separate local state directory. If the preview session cannot create connection keys, the command opens no permissions automatically: it prints a normal device approval URL and waits for approval. Repeating the command reuses the saved registration. The existing computer's registration and database remain untouched.

The production metadata bridge is disabled unless `DEVELOPMENT_COMPUTER_IDS` explicitly lists that computer's ID. It authenticates signed computer requests, rejects browser requests and shared computers, and derives the account owner from the registration. Removing the ID from the allowlist or deleting the registration revokes access. `npm run dev:local -- --bridge-status` checks that endpoint after deployment. Neither command exports integration credentials.

Keep the allowlist out of the repository. After deploying the reviewed bridge, configure it as the production Worker secret `DEVELOPMENT_COMPUTER_IDS` with `npx wrangler secret put DEVELOPMENT_COMPUTER_IDS --env production` from `hub/`. Supply only explicitly approved development computer IDs, comma-separated. Do not replace a pre-existing allowlist without accounting for its registered computers. This string binding is separate from Remy's Secrets Store connection values.

The metadata endpoint is `/api/development/:registrationOrganizationId/bootstrap`. It returns the owner's profile and accessible account/workspace metadata. It is not a general API proxy or production database mirror.

The separately authorized `/api/development/:registrationOrganizationId/thread-access` endpoint returns the selected workspace's merged Workspace and Personal environment values and the owner's Linear execution access. Production checks current workspace access on every request and retains ownership of connection refresh. Local execution can read these values; the browser and local database must not receive them. This does not authorize export of GitHub, cloud hosting, or model credentials. The local connection accepts only the registered owner and those two fixed production endpoints, rejects redirects, and signs a fresh request for each turn.

The shared-account launcher enables memory-only execution access on its separate computer. Unlike an ordinary connected computer, it never saves delivered environment or Linear access records, even encrypted. Restart forgets them, and the next turn must fetch them again. Local code can still read its inherited values and could write or transmit them; this is not a sandbox against that code.

## Remaining work

- Deploy and enable the production bridge, then verify the shared-account launcher against the real account. Local implementation tests do not prove that live path.
- Keep mutable thread and computer state local. Do not attach a second coordinator to production's live state or independently refresh copied provider tokens.
- Verify a real local thread, live output, restart/reconnect, and revocation before calling the loop complete. Cloud execution and GitHub integration are not yet covered by this bridge.

The current focused checks are `node --test hub/scripts/local-development.test.mjs`, `npm test --prefix hub`, and `npm run typecheck --prefix hub`. The local environment tests run in the Web workflow; the bridge access tests run with the hub tests. A public website entry is not appropriate while this development-only setup remains incomplete.
