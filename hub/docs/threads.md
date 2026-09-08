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
| Unavailable computer | Cached transcripts remain readable, explicitly stale. Writes fail with 503, outstanding requests finish with an error, and snapshots become live again after reconnect. |
| Images | Browser uploads bytes over authenticated HTTP to R2. The computer downloads the named object using its own signed HTTP request, validates the image and stores a local copy for its provider. Only attachment references travel on the socket. |

## Access and defaults

Manual starts use `POST /api/organizations/:organizationId/computers/:computerId/threads`
with a computer-advertised `workspaceId`. They default to private. A trusted
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

The older arbitrary computer proxy and raw notification stream are closed to
member requests: they bypass thread access checks and expose machine credentials
and unrelated local data. The socket protocol can still multiplex internal
requests. The welcome frame advertises `threadRelay`; a newer computer sends no
thread frames to an older hub that lacks it.

## Client surface

`#/threads/:threadId?organization=:organizationId&computer=:computerId` opens the
team thread and survives reload. `#/threads?organization=:organizationId` lists
team threads and the available workspace starts. These routes use a same-origin
hub session, with native API clients using their bearer session. The existing
local thread sidebar stays available. Full organization sign-in/navigation and
the native phone's hub navigation remain owned by their later roadmap tickets.

Snapshots contain the latest eight turns, bounded to 96 KB of detail, while the
computer retains its existing complete stored history. The hub retains 128 live
frames per organization. Images are private R2 objects; this change does not add
object retention policies or a full historical attachment cleanup service.

## Reproduce remote-live QA

Install the repository dependencies and build the computer:

```sh
npm run install:all
npm run build --prefix server
node hub/scripts/qa-threads.mjs
```

The command prints a disposable hub address, route and path to its session file.
That file contains test-only credentials and must not be uploaded or committed.
The hub uses actual Workers, D1, R2, member authentication and computer sockets;
only the language-model provider is a deterministic fixture. Its loopback control
endpoint can disconnect, reconnect and evict the isolated coordinator.

In another terminal, start the current UI and an isolated local computer:

```sh
VITE_REMY_HUB_URL=<printed hub URL> npm run qa:web
```

Then run the UI scenario with the two printed values:

```sh
QA_SESSION=<printed session file> QA_WEB_URL=<printed UI URL> node web/scripts/qa-hub-threads.mjs
```

The scenario checks attributed remote messages without navigation or catalogue
refreshes, permission and question responses, duplicate response rejection,
R2 image upload and rendering, offline readable state and rejected writes,
computer reconnect, client reconnect, coordinator restart, deep-link reload,
and desktop/mobile overflow. It saves original recordings and screenshots under
`/tmp/remy-pr-artifacts/wrk-10`. Stop both QA commands to remove their temporary
state. None of these commands stops the packaged computer on port 8420.
