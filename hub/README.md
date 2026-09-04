# Remy for Teams hub

The optional hub connects people and Remy computers while local Remy remains a complete product with no hosted dependency. It runs on Cloudflare Workers with one D1 database for staging and another for production.

Run every command below from `hub/`.

## Bootstrap Cloudflare

Authenticate Wrangler, then create or discover the two databases:

```sh
npm run bootstrap
```

The command is safe to repeat. It prints the non-secret database IDs to copy into `wrangler.jsonc`; it never writes credentials or changes tracked files. Commit the IDs before enabling deployment.

Create `staging` and `production` environments in the GitHub repository. Set these values independently in each environment:

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_ACCOUNT_ID` | The account that owns the matching D1 database and Worker |
| Secret | `CLOUDFLARE_API_TOKEN` | A token with Workers Scripts and D1 write access |
| Secret | `BETTER_AUTH_SECRET` | A distinct random secret of at least 32 characters |
| Variable | `HUB_URL` | The matching `https://…workers.dev` URL |

Use a different `BETTER_AUTH_SECRET` in each environment. Do not put any of these values in `.env`, `.dev.vars`, tracked files, command arguments, logs, or pull requests.

The first deployment creates the named Workers.dev service. If you need its URL before configuring `HUB_URL`, run a one-time Wrangler deploy for that environment with temporary `RELEASE` and `BETTER_AUTH_URL` variables, then copy the URL Wrangler prints. Subsequent deployment runs come only from GitHub Actions.

## Develop locally

```sh
npm install
npm test
npm run typecheck
npx wrangler d1 migrations apply DB --local --env staging
npx wrangler dev --env staging --var RELEASE:local --var BETTER_AUTH_URL:http://127.0.0.1:8787
```

Local secrets belong in `hub/.dev.vars` and are ignored by git. The migration tests start with a fresh database and prove that applying the migration again is a no-op.

## Release

Pull requests that touch `contract/`, `hub/`, or the hub workflow run contract tests, hub tests, typechecks, migration replay, and both environment dry-runs.

A merge to `main` deploys staging with no manual step. The deployment applies remote D1 migrations first, writes the environment's Better Auth secret over stdin, publishes the immutable Git commit as `RELEASE`, and accepts the release only when `/health` reports staging, that commit, and the supported contract version. A migration failure stops before secret update or deployment.

Run the `Hub` workflow from `main` to promote production. The production GitHub environment is the approval boundary; the job uses the same migration-first script and typed health check as staging.

To roll back code, revert the merge and let staging deploy the revert, then promote the same revision to production. D1 migrations are forward-only: ship a corrective migration instead of editing or removing one that ran.

## Observe

Workers Logs records one `request.outcome` JSON event for every request. Filter by `environment`, `release`, or `requestId`; the same request ID is returned in the `x-request-id` response header. Error events contain route and status context but omit headers, bodies, bindings, and error causes.

Hosted computer provisioning remains behind `ComputerRuntimeProvider`. This service setup does not connect authentication routes, organisation board objects, or a runtime provider yet.
