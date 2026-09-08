# Computer Tasks synchronization

An organization retains the authoritative shared log in its Durable Object. A trusted computer can keep a SQLite replica under its organization id. The private local log and existing Mac-to-Mac pairing remain independent: receiving organization data never makes it eligible for private peer replication.

| Path | Owner and behavior |
| --- | --- |
| Permission | An owner or admin explicitly grants shared-board retention to a computer they manage in Computers settings. Hosted computers cannot receive this broad grant. |
| Credential | The computer signs each exchange with its existing private key; every request checks registration, grant, and the granting member's current admin role. |
| Read | The local `/server/hub/board/:entity` returns the replica with last synchronization time and any error, including offline. |
| Write | Local organization changes append to the replica; the signed exchange commits them to the hub and then reads missing events. |
| Live | Opted-in computer connections receive content-free `board.changed` invalidations. Reads still require current authorization. |
| Reconnect | A version vector per organization/device pages through every gap. Duplicate event ids land once; original device/lamport ordering survives. |
| Recovery | A failed read keeps the cache and retries on heartbeat; healthy connections use push. Only one exchange runs at a time. |
| Removal | Removing the computer or granting member removes the grant. Stopping synchronization preserves the existing offline copy; a grant cannot undo data already downloaded. |

The initial import is a separate unchecked choice. It copies the existing board once, preserves log identities, and records the imported entity set. Later changes to those entities follow through; unrelated new private entities stay private. Repository paths are removed from imported workspace events. Imported routines are data in the replica and do not acquire a second local clock. Organization board events are attributed to the authenticated computer; member attribution for web changes is assigned at the hub.

Ticket links carry both thread and computer ids. A link to another computer never means a same-named local thread.

The broad offline copy is deliberately limited to admin-approved trusted computers. Member-specific web access is separate from replica permission; hosted execution uses its own thread capabilities. An imported entity remains shared after import, including later edits from paired local computers.

## Reproduce

Build the current server, run `QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs`, then run `VITE_REMY_HUB_URL=<printed hub URL> npm run qa:web`. Use the printed session file and web URL:

```sh
QA_SESSION=<session file> QA_WEB_URL=<web URL> node web/scripts/qa-hub-board.mjs
```

The isolated check exercises the actual consent controls, private exclusion, import-once behavior, signed grants, live exchange in both directions, wake catch-up, thread links, reload, and narrow layout. Server tests also cover multi-page catch-up, duplicate suppression and unavailable-owner reads. Stop both owned QA commands afterwards.
