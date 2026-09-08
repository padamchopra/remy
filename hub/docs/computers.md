# Computer registration and policy

WRK-11 and WRK-83–87 extend the computer connection from WRK-9 and the thread relay from WRK-10.

A personal computer belongs to the member who attaches it. Only that member can change its policy or remove it; organization admins do not get implicit access to a personal Mac. Organization and hosted computers have no personal owner, can be registered and managed by an owner or admin, and survive their registrar leaving. Hosted is a registration kind, not a provisioning action.

Personal computers start with **Only me**. Shared computers start with **Everyone in your organization**. A **Selected members and teams** policy accepts only current members and teams of that organization. The computer owner retains access. A thread's private/open policy further restricts access: computer access does not grant access to private threads.

Settings → Computers carries the machine's name and icon into its registration. Names and icons can subsequently be edited on the organization computer. Device authorization keeps the device code and private key in the computer process; the window sees the comparison code. The signing key stays in Keychain on ordinary Macs. Existing local-only operation has no hub dependency.

Removing a computer closes its hub connection and removes its hub thread catalogue and notifications. Its local threads, files, and running provider processes remain intact. Detaching from this Mac also clears its local registration and pending hub notifications. A disconnected organization cannot confirm a removal; the control reports that failure instead of claiming success.

## State paths

| Path | Computer policy | Addressed notifications |
| --- | --- | --- |
| Durable owner | Organization D1 registration, ownership and policy | Computer SQLite outbox; organization D1 receipts and Apple Push delivery queue |
| Credentials | Device authorization in the computer; member session for settings; signed computer connection | Computer signing key; member session; Apple key in a hub Secrets Store binding |
| Read | Authenticated computer list filters by use/manage access; cards join visible running thread snapshots | Each member reads only their authorized notifications and their own phone preferences |
| Write | Hub checks current organization membership, ownership/admin role, and selected member/team tenant | Computer supplies thread identity; hub derives recipients from its owner and participants, then checks computer and thread access |
| Live update | Coordinator invalidates computer and thread views on policy changes, removal, reconnect, and team/member changes | Recipient windows refresh their addressed inbox; device preferences invalidate the member's other open windows |
| Reconnect | Computer/policy views make a full authorized read; threads resume or reset their existing cursor | SQLite retries until the hub acknowledges a persisted receipt; unique receipts prevent duplicate delivery; clients refetch and deduplicate alerts |
| Unavailable owner | Last computer list is marked stale; cached threads remain readable only with current access; writes fail | Computer queues up to 1,000 alerts for seven days; hub retries Apple delivery with backoff while the signed-in device remains authorized |

Access checks apply to start, read, write, join, approval, question, interrupt, image upload/download, list snapshots, and replayed live frames. Removing access updates an already-open thread without navigation. Named threads on a computer card open that thread; team transcripts and catalogue rows identify both computer and starter.

## Apple Push

A phone session registers its native Apple token at `POST /api/organizations/:id/notifications/devices` with `{token, environment: "production" | "sandbox", name}`. Tokens are never returned by management reads. Members can disable or delete their own destinations. Session revocation, expiration, membership removal and access changes are checked again before delivery. Open-thread spectators are not notification recipients unless they join.

Configure `APNS_KEY` as a Secrets Store binding containing the `.p8` signing key, with `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC` as configuration values. `BETTER_AUTH_URL` supplies the organization URL carried by a notification. These optional bindings do not affect local Remy or ordinary in-app alerts. The provider uses signed ES256 requests, honors Apple's invalid-device responses, retries transient failures up to eight times, and retains the member's in-app receipt for seven days. Apple transport follows [Apple's provider request documentation](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).

Until native organization navigation lands in WRK-32, the iPhone's notification tap opens the organization thread in its browser. It never interprets the organization thread as a local paired-computer thread. Native account onboarding owns calling the registration API; computer registration and the member-authenticated phone API are ready independently of that later navigation work.

## Reproduce

```sh
npm run build --prefix server
QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs
# Use the printed hub URL in another terminal.
VITE_REMY_HUB_URL=http://127.0.0.1:<hub-port> npm run qa:web
# Use the printed session file and UI URL.
QA_SESSION=<session-file> QA_WEB_URL=http://127.0.0.1:<ui-port> node web/scripts/qa-hub-computers.mjs
```

The fixture uses current Workers/D1/R2 code, real member sessions, and current computer connections. Only the provider adapter is a fixture. It uses temporary databases and loopback ports. The browser check exercises personal denial/grant/revocation, organization registration, named running-thread links, notifications, narrow layout, and removal. Authorization codes are excluded from the reviewer recording. Unrelated tailnet names and addresses are replaced in evidence captures.

Automated tests cover policy and tenant boundaries, organization ownership after member deletion, persistent notification deduplication and retries, session revocation, and the Apple JWT signature/request. A real Apple device delivery requires the deployment's Apple signing key and an opted-in device; it is not simulated as a successful delivery by the UI fixture.
