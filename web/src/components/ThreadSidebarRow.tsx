import { ThreadAvatars, type ThreadPerson } from "./ThreadAvatars";
import type { ReactNode } from "react";
import { Pin } from "lucide-react";
import { SidebarMenuButton } from "./ui/sidebar";
import { ThreadStatus } from "./ThreadStatus";
import type { ChatState } from "@/state/types";
import { plainText } from "@/lib/path";
import { cn } from "@/lib/utils";

export function ThreadSidebarRow({title, active, pinned, time, state, preview, ticket, marks, people, provider, model, hideTimeOnHover, onSelect}: {
  title: string; active: boolean; pinned?: boolean; time: string; state: ChatState;
  people: ThreadPerson[]; provider?: string; model?: string;
  preview?: string; ticket?: ReactNode; marks?: ReactNode; hideTimeOnHover?: boolean; onSelect: () => void;
}) {
  return <SidebarMenuButton data-link aria-label={title} isActive={active} onClick={onSelect}
    className="sidebar-thread h-auto flex-col items-stretch gap-1 px-2.5 py-2.5 group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover group-has-data-[sidebar=menu-action]/menu-item:pr-2.5">
    <span className="flex min-w-0 items-center gap-1.5">
      <ThreadAvatars people={people} provider={provider} model={model} />
      <span className="sidebar-thread-title min-w-0 flex-1 whitespace-normal break-words line-clamp-2">{title}</span>
      {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
      <span className={cn("flex shrink-0 items-center gap-1 text-[11px] font-normal tabular-nums text-muted-foreground", hideTimeOnHover && "transition-opacity [@media(hover:hover)]:group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0")}>{time}</span>
    </span>
    <span className="sidebar-thread-context flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
      <ThreadStatus state={state} />{ticket}
      <span className="min-w-0 flex-1 truncate">{preview ? plainText(preview) : ""}</span>
      {marks}
    </span>
  </SidebarMenuButton>;
}
