import { useEffect, useState } from "react";
import type { ComputerSummary, HubThread, OrganizationWorkspace } from "@remy/contract";
import { normalizeRepositoryOrigin } from "@/lib/hub-workspace-computers";
import { isProjectIconFile } from "@/lib/projects";
import { WorkspaceMarkFrame } from "@/components/WorkspaceMarkFrame";
import { HubWorkspaceIcon } from "@/components/HubWorkspaceIcon";
import { hubThreadAsChat } from "@/components/ThreadMenu";
import { useHubProfile } from "@/lib/hub-profile";
import { watchHubResource } from "@/lib/hub-computers";
import { hubThreadBase } from "@/lib/hub-threads";
import type { HubMember } from "@/lib/hub-organization";
import { agoLabel, elapsedSince, useTicker } from "@/lib/elapsed";
import type { DeviceIconId } from "@/lib/devices";
import type { ChatState } from "@/state/types";
import type { SidebarThread, SidebarThreadGroup } from "./contract";

interface AccountResources {
  members?: HubMember[];
  computers?: ComputerSummary[];
  workspaces?: OrganizationWorkspace[];
}

/// The All view reads several accounts at once, so the subscriptions live in
/// one hook keyed by account rather than one hook call per account, which the
/// rules of hooks would not allow to change length.
function useAccountResources(organizationIds: string[]): Record<string, AccountResources> {
  const [byAccount, setByAccount] = useState<Record<string, AccountResources>>({});
  const key = organizationIds.join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const put = (id: string, patch: AccountResources) =>
      setByAccount((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    const stops = ids.flatMap((id) => [
      watchHubResource<{ members: HubMember[] }>(
        `${hubThreadBase(id)}/members`, (value) => put(id, { members: value?.members }), () => {},
        `${hubThreadBase(id)}/live`),
      watchHubResource<{ computers: ComputerSummary[] }>(
        `${hubThreadBase(id)}/computers`, (value) => put(id, { computers: value?.computers }), () => {},
        `${hubThreadBase(id)}/computers/live`),
      watchHubResource<{ workspaces: OrganizationWorkspace[] }>(
        `${hubThreadBase(id)}/workspaces`, (value) => put(id, { workspaces: value?.workspaces }), () => {},
        `${hubThreadBase(id)}/live`),
    ]);
    return () => { for (const stop of stops) stop(); };
  }, [key]);
  return byAccount;
}

/// Reads the hub and hands `AppSidebar` the same shapes the Mac reader does.
/// One list, ordered by when each thread was started, with pinned threads
/// above it — never split by workspace, because work moves across several at
/// once and a split by repository makes that harder, not easier.
export function useHubThreadGroups({
  organizationId,
  threads,
  onSelect,
  onOpenWorkspace,
}: {
  /// The account the window is showing. In the All view each thread carries
  /// its own, which is what its people and workspaces are read against.
  organizationId: string;
  threads: HubThread[];
  onSelect: (thread: HubThread) => void;
  onOpenWorkspace: (thread: HubThread, workspaceId: string) => void;
}): SidebarThreadGroup[] {
  const { profile } = useHubProfile(organizationId);
  const accounts = [...new Set(threads.map((thread) => thread.access.organizationId || organizationId))].sort();
  const resources = useAccountResources(accounts);
  const now = useTicker(threads.some((thread) => thread.detail.state === "working"));

  const rows = [...threads]
    .sort((left, right) => startedAt(right) - startedAt(left))
    .map((thread): SidebarThread => {
      const account = resources[thread.access.organizationId || organizationId] ?? {};
      const detail = thread.detail;
      const computer = account.computers?.find((entry) => entry.computerId === thread.computerId);
      const local = computer?.capabilities.workspaces.find((entry) =>
        typeof detail.cwd === "string" && (detail.cwd === entry.path || detail.cwd.startsWith(`${entry.path}/`)));
      const workspace = account.workspaces?.find((entry) =>
        entry.id === local?.id
        || (entry.origin && local?.origin && normalizeRepositoryOrigin(entry.origin) === normalizeRepositoryOrigin(local.origin)));
      const state: ChatState = detail.state === "working" || detail.state === "needs_input" || detail.state === "error"
        ? detail.state
        : "idle";
      const preview = typeof detail.preview === "string"
        ? detail.preview
        : [...detail.entries].reverse().find((entry) => typeof entry.text === "string")?.text;
      const childCount = threads.filter((entry) =>
        entry.computerId === thread.computerId && entry.detail.parentChatId === thread.id).length;
      const time = typeof detail.workingSince === "number"
        ? elapsedSince(detail.workingSince, now)
        : agoLabel(typeof detail.updatedAt === "number" ? detail.updatedAt : thread.observedAt, now);
      // The owner is often listed among the participants as well; the row
      // counts people, so it must count each of them once.
      const people = [...new Map([thread.access.owner, ...thread.access.participants]
        .map((person) => [person.id, person])).values()].map((person) => ({
          ...person,
          image: person.id === profile?.id
            ? profile.image
            : account.members?.find((member) => member.userId === person.id)?.image,
        }));
      return {
        key: `${thread.computerId}:${thread.id}`,
        id: thread.id,
        signature: [
          detail.title, time, state, detail.pinned, preview, detail.provider, detail.model,
          thread.access.visibility, workspace?.id, workspace?.name, workspace?.tint, workspace?.icon,
          computer?.computerId, computer?.name, computer?.icon,
          people.map((person) => `${person.id}:${person.image ?? ""}`).join(","),
        ].join("\u0000"),
        title: detail.title,
        time,
        state,
        pinned: detail.pinned === true,
        shared: thread.access.visibility !== "private",
        preview: typeof preview === "string" ? preview : undefined,
        provider: String(detail.provider ?? "codex"),
        model: typeof detail.model === "string" ? detail.model : undefined,
        people,
        workspace: workspace
          ? {
              name: workspace.name,
              mark: (
                <WorkspaceMarkFrame size="sm" tint={workspace.tint}>
                  <HubWorkspaceIcon
                    organizationId={thread.access.organizationId || organizationId}
                    workspaceId={workspace.id}
                    icon={workspace.icon ?? undefined}
                    className={isProjectIconFile(workspace.icon) ? "size-full" : "size-3"}
                  />
                </WorkspaceMarkFrame>
              ),
              onOpen: () => onOpenWorkspace(thread, workspace.id),
            }
          : undefined,
        computer: computer ? { name: computer.name, icon: computer.icon as DeviceIconId } : undefined,
        menu: {
          chat: hubThreadAsChat(thread),
          hosted: {
            organizationId: thread.access.organizationId || organizationId,
            thread,
            computer,
            workspaceId: workspace?.id,
            childCount,
          },
          onOpenWorkspace: workspace ? (id) => onOpenWorkspace(thread, id) : undefined,
        },
        onSelect: () => onSelect(thread),
      };
    });

  const pinned = rows.filter((row) => row.pinned);
  const recent = rows.filter((row) => !row.pinned);
  return [
    ...(pinned.length > 0 ? [{ key: "pinned", label: "Pinned", total: pinned.length, threads: pinned }] : []),
    ...(recent.length > 0 ? [{ key: "threads", label: "Recent threads", total: recent.length, threads: recent }] : []),
  ];
}

/// Newest first, by when the thread was started rather than when it last said
/// something, so a row keeps its place while the work in it moves on.
function startedAt(thread: HubThread): number {
  const created = thread.detail.createdAt;
  if (typeof created === "number") return created;
  return typeof thread.detail.updatedAt === "number" ? thread.detail.updatedAt : thread.observedAt;
}
