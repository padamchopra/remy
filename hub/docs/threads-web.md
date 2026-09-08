# Threads in the hosted app

The hosted composer lists usable, online computers with a compatible version and at least one accessible workspace. Selecting a computer resets its workspace choice. If a chosen computer or workspace loses access, the form requires another selection instead of silently sending work somewhere else.

The hub owns current organization/computer/workspace policy. The computer owns execution and publishes its thread snapshots. Lists, detail, mutations, notification delivery and replay all check the current workspace grant, matching a computer's workspace by registration ID or normalized repository origin. Thread visibility and participant permissions still apply inside that boundary. Workspace and team changes reset open lists; revoking a grant removes a visible thread, and granting it again restores the deep link. Offline snapshots remain readable only while access remains valid.

Run the static hosted app and current computer with `QA_HUB_WEB=1 QA_THREAD_PICKER=1 node hub/scripts/qa-threads.mjs` after building the web and server. Use its printed session file with `web/scripts/qa-hub-picker.mjs` and `web/scripts/qa-hub-threads.mjs` (`QA_WEB_URL` is the printed hub URL). Disposable provider responses exercise streaming, approvals, questions and interruption without affecting production threads.
