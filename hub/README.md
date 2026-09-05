# Remy for Teams hub

The optional hub connects people and Remy computers while local Remy remains a complete product with no hosted dependency. Production runs on Cloudflare Workers; the provider-neutral contract keeps a later self-hosted adapter possible.

Run every command below from `hub/`.

## Bootstrap Cloudflare

Authenticate Wrangler, then create or discover the two databases:

```sh
npm run bootstrap
```

The command is safe to repeat. It prints the non-secret database IDs to copy into `wrangler.jsonc`; it never writes credentials or changes tracked files. Commit the IDs before enabling deployment.

Production binds the `remy-hub-production` D1 database, `remy-hub-production-artifacts` R2 bucket, `remy-hub-production-jobs` Queue, `HubCoordinator` Durable Object, and the account-level `BETTER_AUTH_SECRET` Secrets Store entry. Resource names and IDs live only in `wrangler.jsonc`; the contract used by clients contains no Cloudflare types or account identifiers.

In Cloudflare Workers & Pages, import the `padamchopra/remy` GitHub repository as the `remy-prod` Worker and select `main` as its production branch. The auth secret is read directly from Secrets Store, so no secret is copied into the repository build configuration.

Use `npm run build:hub` as the build command. Use `npm run deploy --prefix hub -- production` as the deploy command. Leave non-production branch deployments disabled.

The deploy script reads the checked-out Git commit as the immutable release. Cloudflare supplies deployment credentials to Workers Builds, so no Cloudflare API token belongs in GitHub.

Do not put `BETTER_AUTH_SECRET` in tracked files, command arguments, logs, or pull requests. Local development may use a distinct disposable value in the ignored `hub/.dev.vars` file.

The production URL belongs to the checked-in Worker configuration, so a stale dashboard variable cannot make a successful deployment fail its smoke check. Production deployments run through the linked Cloudflare build whenever `main` changes.

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

Pull requests that touch `contract/`, `hub/`, or the hub workflow run contract tests, hub tests, typechecks, migration replay, and both environment dry-runs in GitHub Actions. GitHub Actions never receives deployment credentials.

A merge to `main` starts the linked Cloudflare build and deploys production with no GitHub deployment action. The deployment applies remote D1 migrations first, publishes the immutable Git commit as `RELEASE`, and accepts the release only when `/health` reports production, that commit, the supported contract version, and ready bindings. A migration failure stops before deployment.

The staging D1 database and Wrangler environment remain available for restoring a separate staging Worker later, but no staging Worker is currently deployed or connected to GitHub.

To roll back code, revert the merge and let production deploy the revert. D1 migrations are forward-only: ship a corrective migration instead of editing or removing one that ran.

## Observe

Workers Logs records one `request.outcome` JSON event for every request and a redacted `error.unhandled` event for uncaught failures. Filter by `environment`, `release`, or `requestId`; the same request ID is returned in the `x-request-id` response header.

A Cron Trigger checks `/health` every five minutes. Its typed result travels through Queue, is retained at `uptime/latest.json` in R2, and is serialized through the coordinator object. Failed checks retry through Queue and appear as Worker errors. The health response probes D1, R2, the coordinator, Queue binding, and Secrets Store without returning credentials or stored data.

Hosted computer provisioning remains behind `ComputerRuntimeProvider`. This service setup does not connect authentication routes, organisation board objects, or a runtime provider yet.
