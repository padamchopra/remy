# iPhone parity checklist

This checklist maps the desktop capability set in REMY-13 to the iPhone. The
phone remains a fleet client: it can read and direct any paired computer, but it
does not run repositories, agents, browsers, or terminals itself.

## Product parity

| Area | iPhone behavior | Evidence |
|---|---|---|
| Shared contracts | Reads current providers, models, effort, settings, agents, routines, activity, artifacts, pull requests, workspaces, and Tasks from each computer. Older computers retain an explicit fallback. | Contract typecheck and phone contract suite |
| Agents | Creates, edits, deletes, and talks to agents from Inbox, including model, instructions, permissions, identity, and avatar. | REMY-15 |
| Routines | Creates routines conversationally and edits, runs, pauses, and deletes them from the owning agent. Device-agnostic runs follow preferred computer order. | REMY-16 |
| Thread feed | Renders prose, Markdown, code, images, activity, artifacts, todos, context, approvals, and questions. The composer sends images and code references without losing reading position. | REMY-17 |
| Thread control | Creates and switches parent/subthreads, changes model/effort/permission, pins, renames, stops, archives, restores, deletes, adopts as a ticket, and opens its pull request. Detail is kept warm for bounded multitasking. | REMY-18 |
| Browser and terminal | Controls the thread's shared browser through live screenshots and opens a streaming, resizable terminal with command and control-key input. Both processes remain on the owning computer when hidden or backgrounded. | REMY-19 |
| Tasks | Reads the converged board across computers, preserves empty columns and order, moves tickets, and explains cached/partial/offline state. | REMY-20 |
| Ticket workflow | Creates and edits tickets, parents and sub-tickets, comments and mentions, assignee/device/priority/status, thread links, work start, handoff, deletion, and recovery states. | REMY-21 |
| Pull request inbox | Collapses duplicate reports across computers, preserves stack ordering, and shows author, repository, draft/review/check/attention/activity state. Monitoring can inherit or target a thread or agent. | REMY-22 |
| Pull request review | Reads summary, checks, stack, commits, timeline and file diffs; synchronizes viewed files; resumes or builds guided reviews; asks line questions; sends selected context to the related thread; and confirms draft readiness. | REMY-23 |
| Workspaces and worktrees | Adds, styles, renames, configures, and removes local workspace copies. Shows repository copies per computer, branches, dirty state, worktrees and their threads, with guarded cleanup. | REMY-24 |
| Environments | Manages environment names, selection, configured keys, values, and file imports without any response type that can contain a value. Exact output redaction and its encoded-value limit remain visible. | REMY-25 |
| Computers and settings | Discovers and pairs computers on the tailnet, retains QR/link fallback, and manages per-computer providers, defaults, worktrees, Remy model, tooling, integrations, identity, monitoring, notifications, availability, preference order, and analytics. | REMY-26 |
| Navigation and recovery | Keeps Inbox, Threads, Workspaces, Tasks, and Pull requests primary; deep-links every durable destination; routes pushes to the originating computer; restores a useful location; and retains cached content with retry. | REMY-27 |

## Intentional desktop-only behavior

| Capability | Decision |
|---|---|
| Run a repository or provider locally | Desktop-only. The iPhone chooses a paired computer; it is never an execution daemon. |
| Store workspace folders, worktrees, credentials, or environment values | Desktop-only. The phone stores direct pairing credentials and metadata needed to operate the fleet, never repository secrets or files. |
| Host a native browser process or terminal shell | Desktop-only. The phone controls and observes the process owned by the thread's computer. |
| Install or update the desktop application itself | Desktop-only. The phone reports the computer's tooling and update state and can manage supported integrations. |

## Release gates

- [x] Repository typecheck passes.
- [x] Server and phone automated suites pass.
- [x] A production iOS bundle exports successfully.
- [x] Navigation destinations, fleet pull-request collapse/order, reconnect contracts, environment secrecy, and destructive server guards have focused automated coverage.
- [ ] A store-signed build from this commit is available in TestFlight.
- [ ] A small supported iPhone completes pairing, push navigation, background/resume, reconnect, and multiple-computer flows.
- [ ] A large supported iPhone completes the same flows.
- [ ] Agent, routine, thread, Tasks, pull request, workspace, environment, and settings changes are observed round-tripping in the desktop window.
- [ ] The physical-device run confirms no environment value, device token, provider credential, or private tool output appears in logs, screenshots, or crash reports.

The unchecked gates require the store build and physical devices. Record the
tested TestFlight version, devices, results, and any limitations on REMY-28; do
not turn an automated or simulator result into physical-device evidence.
