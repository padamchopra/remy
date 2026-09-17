import { normalizeRepositoryOrigin } from "@/lib/hub-workspace-computers";
import { WorkspaceMarkFrame } from "./WorkspaceMarkFrame";
import { isProjectIconFile } from "@/lib/projects";
import type { ComputerSummary, HubThread, OrganizationWorkspace } from "@remy/contract";
import { ThreadSidebarRow } from "./ThreadSidebarRow";
import { ThreadMenu, hubThreadAsChat } from "./ThreadMenu";
import { useHubProfile } from "@/lib/hub-profile";
import type { HubMember } from "@/lib/hub-organization";
import { HubWorkspaceIcon } from "./HubWorkspaceIcon";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { useHubResource } from "@/lib/hub-organization";
import { agoLabel, elapsedSince, useTicker } from "@/lib/elapsed";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import type { ChatState } from "@/state/types";

export function HubThreadSidebar({organizationId, threads, selected, onSelect, onOpenWorkspace}: {
  organizationId: string; threads: HubThread[]; selected?: {id?: string; computerId?: string}; onSelect: (thread: HubThread) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const {profile} = useHubProfile(organizationId);
  const members = useHubResource<{members: HubMember[]}>(organizationId, "/members");
  const computers = useHubResource<{computers: ComputerSummary[]}>(organizationId, "/computers", "/computers/live");
  const workspaces = useHubResource<{workspaces: OrganizationWorkspace[]}>(organizationId, "/workspaces");
  const now = useTicker(threads.some(thread => thread.detail.state === "working"));
  return threads.map(thread => {
    const detail = thread.detail;
    const computer = computers.value?.computers.find(c => c.computerId === thread.computerId);
    const local = computer?.capabilities.workspaces.find(w => typeof detail.cwd === "string" && (detail.cwd === w.path || detail.cwd.startsWith(`${w.path}/`)));
    const workspace = workspaces.value?.workspaces.find(w => w.id === local?.id || (w.origin && local?.origin && normalizeRepositoryOrigin(w.origin) === normalizeRepositoryOrigin(local.origin)));
    const DeviceIcon = deviceIcon(computer?.icon as DeviceIconId);
    const state: ChatState = detail.state === "working" || detail.state === "needs_input" || detail.state === "error" ? detail.state : "idle";
    const preview = typeof detail.preview === "string" ? detail.preview : [...detail.entries].reverse().find(e => typeof e.text === "string")?.text;
    const childCount = threads.filter(entry => entry.computerId === thread.computerId && entry.detail.parentChatId === thread.id).length;
    return <ThreadMenu key={`${thread.computerId}:${thread.id}`} chat={hubThreadAsChat(thread)} hosted={{ organizationId, thread, computer, workspaceId: workspace?.id, childCount }} onOpenWorkspace={workspace ? onOpenWorkspace : undefined}>
      <ThreadSidebarRow people={[thread.access.owner, ...thread.access.participants].map(person => ({...person, image: person.id === profile?.id ? profile.image : members.value?.members.find(member => member.userId === person.id)?.image}))}
        provider={String(detail.provider ?? "codex")} model={typeof detail.model === "string" ? detail.model : undefined} title={detail.title} active={selected?.id === thread.id && (!selected.computerId || selected.computerId === thread.computerId)}
        state={state} pinned={detail.pinned === true} preview={typeof preview === "string" ? preview : ""}
        time={typeof detail.workingSince === "number" ? elapsedSince(detail.workingSince, now) : agoLabel(typeof detail.updatedAt === "number" ? detail.updatedAt : thread.observedAt, now)}
        onSelect={() => onSelect(thread)}
        hideTimeOnHover
        marks={<>
          {workspace && <Tooltip><TooltipTrigger asChild><span className="shrink-0"><WorkspaceMarkFrame size="sm" tint={workspace.tint}><HubWorkspaceIcon organizationId={organizationId} workspaceId={workspace.id} icon={workspace.icon ?? undefined} className={isProjectIconFile(workspace.icon) ? "size-full" : "size-3"} /></WorkspaceMarkFrame></span></TooltipTrigger><TooltipContent>{workspace.name}</TooltipContent></Tooltip>}
          {computer && <Tooltip><TooltipTrigger asChild><DeviceIcon className="size-3 shrink-0" /></TooltipTrigger><TooltipContent>{computer.name}</TooltipContent></Tooltip>}
        </>} />
    </ThreadMenu>;
  });
}
