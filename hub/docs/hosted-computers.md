# Hosted computers

Each cloud thread gets its own computer. Enable Fly.io Sprites, Modal, or Cursor Cloud in Computers → Cloud, then choose **Cloud · Fly.io Sprites**, **Cloud · Modal**, or **Cloud · Cursor** in the thread's computer picker. Fly and Modal each allocate an isolated guest filesystem; Cursor Cloud runs on Cursor-hosted VMs through the Cursor SDK, and Cursor clones the workspace from its git remote. Local Cursor threads still use Cursor Agent (ACP) on your Mac. The thread picker remembers your choice for that workspace. An explicitly selected disabled provider reports an error instead of silently choosing another provider. Local Remy does not require this service.

Cloud settings contain provider connections and model access. Workspace creation belongs in Workspaces; provider selection belongs with the work being started. Resource limits remain in the existing settings storage/API, with five concurrent task computers by default.

## Model access (unreleased)

Computers → Model access lists Anthropic, OpenAI, Router.com, and OpenRouter API keys. In Personal it lists Codex first: sign in once with a ChatGPT device code (see [ChatGPT sign-in for cloud Codex](#chatgpt-sign-in-for-cloud-codex-unreleased)), or let cloud Codex use the OpenAI key. Cloud Claude uses the Anthropic key; Claude Code account login runs only on a computer you own, because Anthropic does not allow Claude subscriptions in third-party products. Keys autosave after typing pauses; disabling a provider retains its encrypted key and excludes it from new cloud computers. Re-enable it without entering the key again. Keys are never returned to the browser. Pending unsaved edits are cancelled when the section is disabled.

Choose the provider and model when starting a thread. Anthropic, OpenAI, Router.com and OpenRouter remain independent; gateway connections do not override one another or ChatGPT. Model catalogs for gateways load when a key is saved. Cloud threads retain their explicit choice when resumed. Existing computers keep their startup credentials; newly allocated task computers receive the current enabled connections.

OpenRouter uses its [Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses). Real model execution requires a valid key.

## Router.com (unreleased)

Router.com is a model gateway, separate from the cloud computer provider. Save its API key under Model access, then select a model when starting a thread. Model discovery uses `https://api.router.com/v1/models`; Codex uses Router's Responses API at `https://api.router.com/v1`. Remy stores the key encrypted and returns configured state only. New Router-configured cloud computers receive the key through their environment; Codex's configuration contains the environment-variable name, never the value.

This integration requires deploying the new hub endpoints **and publishing a computer image/archive containing the Router changes in `server/`**. Image `0.1.97` does not include them. A real Router response remains unverified without a Router key. Existing active computers retain their startup configuration.

## Deployment

Apply database migrations through 0017. Install `hub/runtime` dependencies before `npm run build:hub --prefix web`. The build bundles the provider adapter as a content-hashed asset and generates its integrity manifest. `node hub/scripts/check-runtime-bundle.mjs` checks that the exact bundle starts and requires management authentication.

Production binds a private Cloudflare Container to the hub using the official Node image. It downloads and verifies the adapter bundle on startup and sleeps after five idle minutes. The hub derives its management credential from `AUTH_SECRET`; no public adapter route or shared vendor credentials are configured. Set `HOSTED_IMAGE` to the published version-tagged GHCR computer image and `HOSTED_ARCHIVE` to that release's Linux archive. The macOS release workflow publishes both.

Users turn on Fly.io Sprites, Modal, or Cursor Cloud in Computers → Cloud, then save their own credentials to finish enabling the connection. Disabled provider cards stay collapsed. Any combination can be enabled together. Cursor Cloud stores the same Cursor API key used to connect; it never returns that key to the browser, and disabling it keeps the encrypted key. The computer picker chooses placement for new threads; `chooseComputer` falls back to an enabled connection when nobody has picked one. Fly and Modal provision guest computers; Cursor Cloud does not. Existing computers retain their provider. Personal accounts own their connections; organization administrators manage shared organization connections. Credentials are encrypted in D1 and sent only to the private adapter for each Fly or Modal operation, never into the guest environment. Cursor Cloud calls Cursor’s API from the hub instead.

Organization → Computers can grant an organization use of a member's enabled Personal cloud connection. The grant stores only the Personal scope, provider id, and which advertised start providers others may use. Provider credentials remain encrypted under the Personal scope, never appear in organization reads, and are resolved by trusted management code only when the organization allocates a computer. Start uses that source account's enabled model access, including OpenRouter, then the share's start allowlist. The owner can always start with any provider. Removing the grant immediately removes that provider from new organization placement without deleting the owner's connection. An account can keep multiple named Fly.io and model-access keys; sharing and new work use the active key.

For a self-hosted hub, the standalone `hub/runtime/Dockerfile` remains supported. Run it behind HTTPS with `REMY_RUNTIME_TOKEN`, bind the same value as `HOSTED_CONTROL_TOKEN`, and configure `HOSTED_CONTROL_URL` instead of the private container binding. Do not expose that service without TLS and its management credential.

Administrators add organization model API keys in Computers. They are AES-GCM encrypted in D1 with organization-bound authenticated data and a key derived from AUTH_SECRET. Back up that secret: rotation requires re-encrypting the records. Reads return configured names only. Bootstrap injects those keys into process environments; Codex's configuration refers to OPENAI_API_KEY without writing its value. Each person's ChatGPT sign-in is sealed the same way under their Personal scope, in its own table, and never enters a computer's environment. Cloud computers never run Claude Code account login. A hostile process can deliberately write its own environment; filesystem snapshots are not a protection against that action.

The provider enforces the outbound domain allowlist outside the guest. The computer carries its own Ed25519 identity, never an organization administration credential. The Node control service is trusted management infrastructure and must be isolated from guests.

## ChatGPT sign-in for cloud Codex (unreleased)

Your ChatGPT sign-in is yours, like any Personal connection. Open Personal → Computers → Cloud → Model access, choose Connect Codex, open OpenAI's sign-in page, and enter the displayed code. There is no workspace to pick and no computer to start: the hub runs the device-code flow itself, mirroring the Codex CLI (`codex-rs/login/src/device_code_auth.rs` and `auth/manager.rs` in openai/codex). Device code login must be enabled in your ChatGPT security settings or workspace permissions. Cancel an attempt, or retry one that expired after 15 minutes, from the same place.

In each organization you belong to, Organization → Computers → Your subscriptions has your own ChatGPT switch. It starts on, the way a Personal connection is available to every organization, and only you can change it; administrators cannot turn it on or off for you. Any member of an organization with a Fly.io or Modal connection, its own or shared into it, can start cloud Codex threads on their own ChatGPT. Nobody else's sign-in ever starts your thread, and the composer shows **ChatGPT** only when you are signed in and your switch is on for that organization. A share grant's provider list does not limit it, because the plan is yours, not the share owner's.

A thread keeps its starter's sign-in for its whole life: the Codex session belongs to whoever started it, so a turn another participant sends in that thread still runs on the starter's plan.

The hub is the only holder of the tokens, because a refresh token rotates and only one place can spend it. They are AES-GCM sealed in D1 under your Personal scope (`personal_chatgpt_accounts`). One Durable Object per person polls the device code, exchanges it, and refreshes the tokens one request at a time. A cloud task computer asks `/computers/codex-tokens` with its own signed identity; the hub finds the thread's starter, checks that their switch is on for that organization, and returns only a short-lived access token and ChatGPT account id. Codex on the task uses its external-token login and asks again through the same route when it needs a refresh. Management reads return phase and email only; browsers, logs, computer environments and thread snapshots never receive tokens.

Disconnecting removes the stored tokens. Turning your switch off in an organization, or a refresh OpenAI rejects, has the same effect on running threads there: their next turn or refresh fails and asks you to reconnect Codex. Threads started on an OpenAI, Router.com or OpenRouter key never ask for ChatGPT tokens.

A real ChatGPT account, and OpenAI's acceptance of device-code and refresh requests from Cloudflare Workers, have not been exercised. The flow, rotation, per-person serving and the organization switch are covered against a fake OpenAI auth server (`hub/scripts/fake-openai-auth.mjs`; `QA_CHATGPT=1 node hub/scripts/qa-threads.mjs`, then `web/scripts/qa-hub-codex-account.mjs`).

## Account login on a computer you own

Sign in to Codex with ChatGPT, or to Claude Code with your Claude account, from Computers → Connected on a Mac or other computer you own. Hub routes that would begin a Claude Code paste-code session for a cloud computer return an error, as does the per-computer Codex route on a task computer; cloud Codex uses your Personal ChatGPT sign-in instead. Claude Code and Codex must already be installed on that computer; Remy does not install them remotely. Connect Claude Code stores the account for the next Claude session; Connect Codex needs Codex installed so it can run ChatGPT device-code on the machine.

## Provider keys on a computer you connected

Computers → Connected sets an Anthropic or OpenAI key on one connected computer, and offers Connect Claude Code and Connect Codex on that same computer, so nobody has to open a shell on that machine. Only someone who can manage the computer can connect an account or set a key. Account sessions and `computer_model_keys` rows are AES-GCM encrypted with the computer id as authenticated data, and management reads return the configured state rather than the value. The computer pulls Claude credentials over its own authenticated connection and writes Claude Code's credentials file; Codex device-code runs on that computer through its installed CLI. Removing the computer, or detaching it from the machine, forgets the keys and the Claude account Remy stored. Cloud computers keep using organization model access instead. A provider or command can read the environment it inherits; keys set this way are no more contained than a workspace environment value.

Official Codex protocol: https://developers.openai.com/codex/app-server/#auth-endpoints. Headless sign-in: https://developers.openai.com/codex/auth/#login-on-headless-devices.

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

The new per-task allocation, environment delivery, and ChatGPT token paths are covered by isolated runtime/protocol fixtures.

### Sprite activity

A hosted Sprite holds a short-lived activity task while Remy runs. It renews every 30 seconds, expires after two minutes if the process dies, and is released on normal shutdown. The hub still owns the configured idle timeout and stops idle computers. This prevents Sprite suspension from interrupting startup, outbound connections, or active turns. Git credential setup replaces its helper list before adding the Remy helper, so a retry does not accumulate duplicate values.
