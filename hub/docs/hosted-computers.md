# Hosted computers

WRK-15 and WRK-103–108 add one hosted computer per workspace. Organization defaults are overridden in Computers; an unset workspace inherits defaults. Hosting is disabled until an administrator enables it. Local Remy does not call or require this service.

## Computer sizes

Fly Sprites manages resources automatically; Remy does not send CPU, memory or region overrides to its create API. Modal offers Light (0.5 CPU, 1 GiB), Standard (1 CPU, 2 GiB) and Heavy (4 CPU, 8 GiB) starting points. Standard matches the existing defaults. Customize exposes Modal CPU, memory and region plus idle time for either provider. Presets only fill resource values; saved settings and workspace inheritance remain unchanged. Existing computers retain their allocation until a new allocation applies the settings.

## Deployment

Apply migration 0009. Build `hub/runtime/Dockerfile` with the repository as its context. Run it behind HTTPS with `REMY_RUNTIME_TOKEN` (at least 32 random characters), and vendor credentials supplied through your deployment secret manager: Modal's supported token environment variables and/or `SPRITES_TOKEN`. The service defaults to loopback; its container binds its own service port, never the Remy computer's port 8420. Do not expose the service without TLS and the credential.

Bind the hub's `HOSTED_CONTROL_TOKEN` Secret Store entry to the same credential. Set `HOSTED_CONTROL_URL`, `HOSTED_IMAGE` to the version-tagged GHCR computer image, and `HOSTED_ARCHIVE` to that release's Linux archive. The macOS release workflow publishes these independently after the DMG release. Vendor credentials and the control credential never reach a hosted computer.

Administrators add organization model API keys in Computers. They are AES-GCM encrypted in D1 with organization-bound authenticated data and a key derived from AUTH_SECRET. Back up that secret: rotation requires re-encrypting the records. Reads return configured names only. Bootstrap injects keys into process environments; Codex's configuration refers to OPENAI_API_KEY without writing its value. Personal subscription sessions are not copied. A hostile process can deliberately write its own environment; filesystem snapshots are not a protection against that action.

The provider enforces the outbound domain allowlist outside the guest. The computer carries its own Ed25519 identity, never an organization administration credential. The Node control service is trusted management infrastructure and must be isolated from guests.

## Lifecycle and accounting

Workspace opening, composer activity and ticket assignment prewarm an enabled workspace. Concurrent requests share one allocation. The existing computer/thread transport handles hosted computers. Active work remains warm; after 10–15 idle minutes the service stops the process, checkpoints storage and suspends compute. Wake preserves the computer identity. Failed operations remain visible and are retryable. Workspace/organization deletion removes hosted resources before removing their records.

Active and warm-idle milliseconds are separate from logical snapshot-byte milliseconds. These are usage estimates, not vendor invoices. Source rows retain the provider, runtime reference and time interval. Modal snapshots superseded by a durably recorded replacement are pruned asynchronously. Fly controls its own checkpoint retention. `/data` includes model transcript directories as well as Remy's SQLite state; `/workspace` includes repository state.

## Validation and remaining rollout gates

The current release-built image passed an actual Modal V2 allocation, daemon health check, thread/workspace write, filesystem checkpoint, termination and restore. The restored thread ID/title and workspace contents matched. One disposable run measured 4.3 s allocation, 5.1 s checkpoint and 3.3 s restore. Reproduce with `REMY_TEST_IMAGE=<built image> npx tsx scripts/prove-modal.ts` from `hub/runtime`; it removes its own sandbox and snapshot in finally.

The browser QA covers defaults, workspace overrides/reset, member denial, key configuration/removal without readback, explicit allocation failure, and mobile layout. Unit tests cover lifecycle serialization, metering, checkpoint failure and encryption isolation.

Live Fly verification awaits a configured organization. A real model conversation and first-useful-response measurement await an organization API key. Modal rotates at 23 hours, before its 24-hour limit: it interrupts active turns, saves their provider transcripts, checkpoints and restores the same computer. Remy sends a visible continuation with a stable deduplication key; pending questions and approvals are requested again, never granted by the restart. This briefly interrupts work and does not preserve in-memory shells. Keep this change in draft until the live provider/model gates are resolved.

A directory-only snapshot into a pre-warmed base would require a second allocation plus explicit reconstruction of SQLite, repository and provider transcript state. The measured full-filesystem restore is already 3.3 seconds and preserves all three together; retain filesystem restore until a directory prototype demonstrates a material improvement. This is an architectural evaluation, not a measured directory-snapshot comparison.

## Preset price estimates

Modal presets show approximate USD compute costs per running hour: Light $0.09, Standard $0.19 and Heavy $0.76. Custom values recalculate immediately. These use the [Modal Sandbox rates](https://modal.com/pricing) checked September 10, 2026: $0.00003942 per physical CPU core-second and $0.00000667 per GiB-second. Running time includes warm idle time; higher actual usage and region surcharges increase the cost. Storage and model charges are separate, and estimates exclude credits and taxes. Fly uses automatic resources rather than these presets.
