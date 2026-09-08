# Agent scopes

WRK-18 and WRK-119–124 add organization, team, workspace and personal ownership to agent log rows. Inbox groups agents by scope while retaining the thread sidebar. Personal agents are private to their owner, including from organization administrators. Team membership and workspace restrictions are checked on every read, message, memory access and ticket assignment.

Personal-to-team and team-to-organization sharing retains the agent ID, conversation, memories and audit history. The action explains that existing context is shared. Narrowing or transferring personal ownership through field edits is refused. Members may manage their own/team agents; organization-wide changes require an administrator.

Deleting an agent removes its hub conversation, tombstones its memories and routines, and makes its computer-owned threads inaccessible immediately. Connected computers remove those threads; an offline computer receives deletion on reconnect. A departing member's personal agents are deleted; team agents and their conversations remain with the team. Removing a team/workspace removes agents owned by it.

The legacy computer-wide Tasks replica now exchanges projects and tickets only. Agent/memory/routine records are removed from that separate cache on startup and rejected in sync requests. Local Remy agents remain local. This avoids treating a broad Tasks-sharing grant as permission to export personal agents. Previously exported copies outside Remy's control cannot be recalled.

Browser QA proves personal creation, conversation and memory, outsider denial, promotion with retained context, shared deletion and mobile layout. Hub tests cover access, assignment, departure and filtered export. Agent execution and the hub's built-in colleagues follow in WRK-19; this layer stores conversation messages without inventing model replies.
