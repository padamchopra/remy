# Threads through the hub

WRK-10 covers WRK-76–82. A thread's computer owns its transcript, execution,
visibility and participants. The organization coordinator keeps a bounded mirror
for live delivery and offline reading. Local threads are never published merely
because their computer connects to an organization.

| Path | Owner and implementation |
| --- | --- |
| Durable state | Computer SQLite: chat rows and entries, `hubThreadAccess`, and persisted snapshot revisions. Provider sessions resume using their existing provider transcript IDs. |
| Credentials | Hub authenticates a member session or phone bearer token. The computer proves its identity with its keypair. Computer credentials never enter the browser. |
| Read | Organization list merges computer-published snapshots. An online detail read goes through the computer socket; an offline detail returns the last snapshot with `stale: true`. |
| Write | The hub derives the actor from the session and checks organization membership, computer ownership of the address, and cached thread access. The computer checks organization and thread access again, applies the action, persists it, and returns the authoritative snapshot. |
| Live update | Local chat broadcasts trigger a coalesced computer snapshot. The coordinator records a cursor and publishes it to authorized viewers. A private thread is absent to other members; changing visibility removes it from readers who have not joined. |
| Reconnect | Clients resume from the last cursor and suppress duplicates. Expired cursors receive reset and a new list read. A computer reconnect republishes its shared threads and a manifest, removing mirrors of deleted threads. Revisions prevent a late response overwriting a newer update. |
| Unavailable computer | Cached transcripts remain readable, explicitly stale. A hosted computer is woken for pin, rename, archive, and delete. Archive and delete of a hosted thread you can write still succeed if that computer cannot resume, and the thread stays gone after it reconnects. Other writes fail with 503 until reconnect. |
| Code references | A message may carry `codeReferences`: up to 20 file ranges, each with its path, lines and comment, such as lines sent from a pull request's diff. The hub refuses what could never be valid and forwards the rest; the computer validates each one (`server/src/chat-references.ts`), gives its provider a review-context block, and keeps them on the user entry so the thread shows them. Cursor Cloud, which takes text alone, receives the same block in the message text. |
| Reviews | A review is a thread with a pull request attached: its computer checks the head out in its own worktree, and each message carries its owner's rules and the commit it is about. Findings, proposals and rules live on the hub (`review-agent.md`). |
| Images | Browser uploads bytes over authenticated HTTP to R2. The computer downloads the named object using its own signed HTTP request, validates the image and stores a local copy for its provider. Only attachment references travel on the socket. |
| New thread start | The organization coordinator stores the complete start command before provisioning. Its request UUID is the final thread UUID. Polling, browser reconnect, and the coordinator alarm resume the same idempotent checkpoints until the computer has created the thread and accepted its first message. |

## Access and defaults

Manual starts use `POST /api/organizations/:organizationId/threads` with a
computer-advertised `workspaceId`, a final thread UUID, and the first message.
The hub forwards that UUID to the computer and uses it as the provider resource
identity, so a retry cannot create another thread or cloud computer. They default to private. A trusted
computer integration can call `shareHubThread` with `external` or `automatic` to
default to open; clients cannot select their own trusted source or actor.

Open threads are readable by organization members. Joining adds a participant
before sending, answering, approving, interrupting or renaming. Only the person
who started a thread changes its visibility. Making it private preserves access
for existing participants. Removing organization membership cuts off API and live
access even if the member remains in the computer's participant history.

Prompt entries and successful approval/question responses retain the member's ID
and display name on the computer. An expired request ID cannot answer another
request. Message IDs make a retried prompt idempotent. Answering an approval never
implicitly grants a different decision.

The hub checkpoints computer selection, thread creation, and first-message
delivery in Durable Object storage. Each stage can repeat. The computer creates
the supplied thread UUID, and the first message uses `u-<thread UUID>`, which
the computer deduplicates. A coordinator restart leaves the command pending;
the next status read or alarm continues it. A caught provider failure remains
visible and Retry clears that failure while keeping the same identities.

The older arbitrary computer proxy and raw notification stream are closed to
member requests: they bypass thread access checks and expose machine credentials
and unrelated local data. The socket protocol can still multiplex internal
requests. The welcome frame advertises `threadRelay`; a newer computer sends no
thread frames to an older hub that lacks it.

## Client surface

`/threads` opens the combined All view, while `/threads?organization=:organizationId`
narrows it to one account. `/threads/:threadId` opens that thread and survives
reload; computer, owner, and organization do not belong on that address. A
narrowed account lists its threads and available workspace starts. The new-thread
composer resolves the workspace preference and its computer choice before it appears
ready, preselects the resulting concrete computer or cloud provider, and submits
that explicit choice.
Its picker contains only available execution choices; it has no automatic value.
These routes use a same-origin
hub session, with native API clients using their bearer session.

Snapshots contain the latest readable tail, bounded to 96 KB. Activity
heartbeats stay out of that budget. When earlier messages remain, the snapshot
says so, and the open thread reads those pages from its computer. The computer
retains its complete stored history. The hub retains 128 live
frames per organization. Images are private R2 objects; this change does not add
object retention policies or a full historical attachment cleanup service.

The computer keeps only the latest 500 entries in memory; that limit does not
delete SQLite rows. History reads page backward through stored entries, including
after a restart, and snapshots advertise earlier rows outside the memory tail.
An offline hub snapshot remains bounded: reading history outside it requires the
computer to reconnect. Entries already deleted by older computer versions are
not reconstructed by this retention change.

## Reproduce remote-live QA

Install the repository dependencies and build the computer:

```sh
npm run install:all
npm run build --prefix server
npm run build --prefix web && npm run build:website --prefix web && node web/scripts/assemble-hub.mjs
QA_HUB_WEB=1 node hub/scripts/qa-threads.mjs
```

The command prints a disposable hub address, route and path to its session file.
That file contains test-only credentials and must not be uploaded or committed.
The hub uses actual Workers, D1, R2, member authentication and computer sockets;
only the language-model provider is a deterministic fixture. Its loopback control
endpoint can disconnect, reconnect and evict the isolated coordinator.

`QA_HUB_WEB=1` makes the hub serve the web app in `web/dist` from the same
origin, in the deployed layout `assemble-hub.mjs` produces. Run the UI scenario
against the printed hub address:

```sh
QA_SESSION=<printed session file> QA_WEB_URL=<printed hub URL> node web/scripts/qa-hub-threads.mjs
```

The scenario checks attributed remote messages without navigation or catalogue
refreshes, permission and question responses, duplicate response rejection,
R2 image upload and rendering, offline readable state and rejected writes,
computer reconnect, client reconnect, coordinator restart, deep-link reload,
and desktop/mobile overflow. It saves original recordings and screenshots under
`/tmp/remy-pr-artifacts/wrk-10`. Stop the hub command to remove its temporary
state. It never stops the packaged computer on port 8420.

## Agent orchestration (unreleased)

The Remy MCP exposes `start_thread`, `list_threads`, `read_thread`, and `send_to_thread` for Claude, Codex, Cursor ACP, and PR review agents. Thread-scoped computer authorization binds each call to its initiating member; the hub checks current membership, workspace and computer access, and thread visibility and write access. Discovery includes unarchived idle, waiting, and working threads across accessible computers. Offline snapshots can be read; sends return a computer-offline error.

Starting a thread inherits the current computer and folder, provider, model, effort, permission mode, and visibility. Optional settings override those values; permission overrides can keep or narrow the current permissions. Change the sending thread’s permissions in the app before delegating with broader permissions. Changing providers without a model selects that provider’s default. A child shares the parent’s checkout when using the same workspace, has a separate conversation, and does not inherit a review attachment or rename the shared checkout’s branch. Workspace overrides name a registered folder on the same computer. Personal environment values and model access stay owned by the initiating person and are checked on the hub; no credentials are copied into tool results or messages.

The hub derives sender metadata from the source snapshot and binds authorization to the person’s id separately. Messages retain this metadata in daemon storage and hub snapshots, appear as `Claude [thread title]` (or Codex/Cursor), and link to the sending thread. Provider prompts identify agent messages as agent messages. Retry the same start with `request_id` or message with `message_id` to suppress duplicates. Both the hub and computer runtime need this update; a running provider session must restart to receive its new tool definitions.
