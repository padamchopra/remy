# Hosted computers

Each cloud thread gets its own computer and isolated filesystem. Enable one or both providers in Computers → Cloud, then choose **Cloud · Fly.io Sprites** or **Cloud · Modal** in the thread's computer picker or routing rules. The thread picker remembers your choice for that workspace. An explicitly selected disabled provider reports an error instead of silently choosing another provider. Local Remy does not require this service.

Cloud settings contain provider connections and model access. Workspace creation belongs in Workspaces; provider selection belongs with the work being started. Resource limits remain in the existing settings storage/API, with five concurrent task computers by default.

## Model access (unreleased)

Computers → Model access gives each provider its own key field. Keys autosave after typing pauses; disabling a provider retains its encrypted key and excludes it from new cloud computers. Re-enable it without entering the key again. Keys are never returned to the browser. Pending unsaved edits are cancelled when the section is disabled.

Choose the provider and model when starting a thread. Anthropic, OpenAI, Router.com and OpenRouter remain independent; gateway connections do not override one another or ChatGPT. Model catalogs for gateways load when a key is saved. Cloud threads retain their explicit choice when resumed. Existing computers keep their startup credentials; newly allocated task computers receive the current enabled connections.

OpenRouter uses its [Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses). Both the hub and computer runtime must be updated before using this integration. Real model execution requires a valid key.

## Router.com (unreleased)

Router.com is a model gateway, separate from the cloud computer provider. Save its API key under Model access, then select a model when starting a thread. Model discovery uses `https://api.router.com/v1/models`; Codex uses Router's Responses API at `https://api.router.com/v1`. Remy stores the key encrypted and returns configured state only. New Router-configured cloud computers receive the key through their environment; Codex's configuration contains the environment-variable name, never the value.

This integration requires deploying the new hub endpoints **and publishing a computer image/archive containing the Router changes in `server/`**. Image `0.1.97` does not include them. A real Router response remains unverified without a Router key. Existing active computers retain their startup configuration.

## Deployment

Apply database migrations through 0017. Install `hub/runtime` dependencies before `npm run build:hub --prefix web`. The build bundles the provider adapter as a content-hashed asset and generates its integrity manifest. `node hub/scripts/check-runtime-bundle.mjs` checks that the exact bundle starts and requires management authentication.

Production binds a private Cloudflare Container to the hub using the official Node image. It downloads and verifies the adapter bundle on startup and sleeps after five idle minutes. The hub derives its management credential from `AUTH_SECRET`; no public adapter route or shared vendor credentials are configured. Set `HOSTED_IMAGE` to the published version-tagged GHCR computer image and `HOSTED_ARCHIVE` to that release's Linux archive. The macOS release workflow publishes both.

Users turn on Fly.io Sprites or Modal in Computers → Cloud, then save their own credentials to finish enabling the connection. Disabled provider cards stay collapsed. Both can be enabled together. The computer picker and routing rules choose placement for new threads; automatic placement uses an enabled connection. Existing computers retain their provider. Personal accounts own their connections; organization administrators manage shared organization connections. Credentials are encrypted in D1 and sent only to the private adapter for each operation, never into the guest environment.

For a self-hosted hub, the standalone `hub/runtime/Dockerfile` remains supported. Run it behind HTTPS with `REMY_RUNTIME_TOKEN`, bind the same value as `HOSTED_CONTROL_TOKEN`, and configure `HOSTED_CONTROL_URL` instead of the private container binding. Do not expose that service without TLS and its management credential.

Administrators add organization model API keys in Computers. They are AES-GCM encrypted in D1 with organization-bound authenticated data and a key derived from AUTH_SECRET. Back up that secret: rotation requires re-encrypting the records. Reads return configured names only. Bootstrap injects keys into process environments; Codex's configuration refers to OPENAI_API_KEY without writing its value. An administrator can also connect Codex to ChatGPT for each workspace using the official device-code flow. Codex owns its tokens and refreshes them in `/data/codex`; Remy relays the short-lived code and account status to the browser. Task computers receive short-lived access tokens through an authenticated hub broker; refresh tokens stay in the connection computer. A connected account takes precedence over the OpenAI API key for new Codex turns. Disconnecting returns new turns to the configured API key. Claude continues to use the Anthropic API key. A hostile process can deliberately write its own environment; filesystem snapshots are not a protection against that action.

The provider enforces the outbound domain allowlist outside the guest. The computer carries its own Ed25519 identity, never an organization administration credential. The Node control service is trusted management infrastructure and must be isolated from guests.

## Codex sign-in

Select a workspace in Computers, choose Prepare Codex connection, then Connect Codex. Open OpenAI’s sign-in page and enter the displayed code. Device code login must be enabled in your ChatGPT security settings or workspace permissions. Cancel or retry an expired attempt from the same computer. A successful connection updates the open page without navigation; reconnecting performs a fresh account read.

The connection belongs to the workspace, including tasks started by other authorized workspace members. Only admins with workspace access can manage it. A separate connection computer retains Codex’s refresh credentials in `/data/codex`, so task computers can start or restore without another device-code login. Signed task identities can request access tokens only for their bound workspace. The connection computer refreshes tokens through Codex’s official account API; tasks use its experimental external-token login and refresh protocol. The browser never receives account tokens. A revoked or expired login can still require reconnecting. The connection computer is additional compute outside the task concurrency limit and sleeps under the same idle policy. Checkpoints contain credentials: keep snapshots private and account for vendor retention.

The computer keeps one authentication app-server process while it runs. Pending codes expire locally and are lost on process restart; completed authentication survives in persistent storage. New turns use the updated connection; an already running turn is not interrupted. The outbound allowlist includes `auth.openai.com`, `chatgpt.com` and `ab.chatgpt.com`. Older computer images without the account handler must be upgraded before connecting.

Official protocol: https://developers.openai.com/codex/app-server/#auth-endpoints. Headless sign-in: https://developers.openai.com/codex/auth/#login-on-headless-devices.

## Lifecycle and accounting

Starting a task allocates its computer. Opening a workspace or typing does not allocate one. Retrying the same task reuses its allocation; separate tasks allocate separately up to the configured maximum (five by default). The limit counts running and warm idle task computers across the organization. The existing computer/thread transport handles hosted computers. Active work remains warm; after 10–15 idle minutes the service stops the process, checkpoints storage and suspends compute. Wake preserves the computer identity. Failed operations remain visible and are retryable. Workspace/organization deletion removes hosted resources before removing their records.

Active and warm-idle milliseconds are separate from logical snapshot-byte milliseconds. These are usage estimates, not vendor invoices. Source rows retain the provider, runtime reference and time interval. Modal snapshots superseded by a durably recorded replacement are pruned asynchronously. Fly controls its own checkpoint retention. `/data` includes model transcript directories as well as Remy's SQLite state; `/workspace` includes repository state.

## Validation and remaining rollout gates

The current release-built image passed an actual Modal V2 allocation, daemon health check, thread/workspace write, filesystem checkpoint, termination and restore. The restored thread ID/title and workspace contents matched. One disposable run measured 4.3 s allocation, 5.1 s checkpoint and 3.3 s restore. Reproduce with `REMY_TEST_IMAGE=<built image> npx tsx scripts/prove-modal.ts` from `hub/runtime`; it removes its own sandbox and snapshot in finally.

The browser QA covers personal and organization settings, independent providers, immediate toggle feedback and failed-write rollback, Router model discovery and key removal, saved cloud choices, and desktop/mobile layout. Unit tests cover lifecycle serialization, metering, checkpoint failure and encryption isolation.

Live Fly verification awaits a configured organization. A real model conversation and first-useful-response measurement await an organization API key. Modal rotates at 23 hours, before its 24-hour limit: it interrupts active turns, saves their provider transcripts, checkpoints and restores the same computer. Remy sends a visible continuation with a stable deduplication key; pending questions and approvals are requested again, never granted by the restart. This briefly interrupts work and does not preserve in-memory shells. Keep this change in draft until the live provider/model gates are resolved.

A directory-only snapshot into a pre-warmed base would require a second allocation plus explicit reconstruction of SQLite, repository and provider transcript state. The measured full-filesystem restore is already 3.3 seconds and preserves all three together; retain filesystem restore until a directory prototype demonstrates a material improvement. This is an architectural evaluation, not a measured directory-snapshot comparison.

## Workspace environments

Settings → Environments stores reusable encrypted values and assigns them to one or more workspaces. Authenticated computer channels synchronize assignments to registered local clones and task computers. Providers inherit the assigned values; updates apply on the next turn, restarting the provider session when values change. Offline computers retain their last synchronized state until reconnecting. Management responses contain names only. Exact redaction cannot recognise encoded or transformed values, and providers or commands can deliberately read their inherited values.

The new per-task allocation, environment delivery, and external Codex refresh paths are covered by isolated runtime/protocol fixtures. A real ChatGPT account across paid cloud checkpoint/restore has not been exercised for this change.

### Sprite activity

A hosted Sprite holds a short-lived activity task while Remy runs. It renews every 30 seconds, expires after two minutes if the process dies, and is released on normal shutdown. The hub still owns the configured idle timeout and stops idle computers. This prevents Sprite suspension from interrupting startup, outbound connections, or active turns. Git credential setup replaces its helper list before adding the Remy helper, so a retry does not accumulate duplicate values.
