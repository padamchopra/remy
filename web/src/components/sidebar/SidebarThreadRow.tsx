import { memo, useState } from "react";
import { Lock, Users } from "lucide-react";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ThreadStatus } from "@/components/ThreadStatus";
import { ProviderMark } from "@/components/ProviderMark";
import { ThreadMenu } from "@/components/ThreadMenu";
import { deviceIcon } from "@/lib/devices";
import { reportRender } from "@/lib/render-probe";
import { cn } from "@/lib/utils";
import { SidebarThreadCard } from "./SidebarThreadCard";
import type { SidebarThread } from "./contract";

/// The row is deliberately two lines and no more. The title gets both of them
/// when it needs them, and everything that used to compete with it — the
/// workspace, the machine, the model, who can see it — is an icon on the
/// second line, in one order, so the lane starts at the same x on every row.
/// The hover card says all of it in words.
function SidebarThreadRowInner({ thread, active }: { thread: SidebarThread; active: boolean }) {
  const [cardOpen, setCardOpen] = useState(false);
  const DeviceIcon = deviceIcon(thread.computer?.icon);
  reportRender("thread-row", thread.id);

  const row = (menuOpen: boolean) => (
    <SidebarMenuButton
      data-link
      aria-label={thread.title}
      isActive={active}
      onClick={thread.onSelect}
      className="sidebar-thread h-auto flex-col items-stretch gap-1 px-2.5 py-2.5 group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover group-has-data-[sidebar=menu-action]/menu-item:pr-2.5"
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className="sidebar-thread-title min-w-0 flex-1 whitespace-normal break-words line-clamp-2">
          {thread.title}
        </span>
        {/* The time sits where the row's action appears and gives way to it,
            so no row keeps an empty margin for a control that is not there. */}
        <span className={cn(
          "shrink-0 font-mono text-[11px] leading-[18px] font-normal tabular-nums text-muted-foreground transition-opacity",
          "[@media(hover:hover)]:group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0",
          menuOpen && "opacity-0",
        )}>{thread.time}</span>
      </span>
      <span className="sidebar-thread-context flex min-w-0 items-center gap-[7px] text-xs font-normal text-muted-foreground">
        {thread.workspace?.mark}
        {thread.computer && <DeviceIcon className="size-3 shrink-0" />}
        {thread.provider && <ProviderMark provider={thread.provider} className="size-3 shrink-0" />}
        {/* The last slot says how the thread is shared, as one glyph like the
            three before it. Who is in it is a list of names, which is what
            the hover card is for. */}
        {thread.shared === undefined ? null
          : thread.shared ? <Users aria-label="Shared" className="size-3 shrink-0" />
          : <Lock aria-label="Private" className="size-3 shrink-0" />}
        <span className="flex-1" />
        <ThreadStatus state={thread.state} />
      </span>
    </SidebarMenuButton>
  );

  return (
    <ThreadMenu {...thread.menu}>
      {(menuOpen) => (
        <HoverCard openDelay={450} open={cardOpen && !menuOpen} onOpenChange={setCardOpen}>
          <HoverCardTrigger asChild>{row(menuOpen)}</HoverCardTrigger>
          <HoverCardContent side="right" align="start" className="w-72">
            <SidebarThreadCard thread={thread} />
          </HoverCardContent>
        </HoverCard>
      )}
    </ThreadMenu>
  );
}

export const SidebarThreadRow = memo(
  SidebarThreadRowInner,
  (previous, next) =>
    previous.active === next.active && previous.thread.signature === next.thread.signature,
);

/// A subthread under its parent, hanging off a guide line the way a tree draws
/// a branch: the line runs the height of the row and the last one ends in an
/// elbow.
export const SidebarChildThreadRow = memo(function SidebarChildThreadRow({
  thread,
  active,
  last,
}: {
  thread: SidebarThread;
  active: boolean;
  last: boolean;
}) {
  reportRender("thread-row", thread.id);
  return (
    <ThreadMenu {...thread.menu}>
      <SidebarMenuButton
        data-link
        size="sm"
        isActive={active}
        className={cn(
          "relative h-7 gap-1.5 overflow-visible pl-7 text-xs",
          "before:absolute before:left-[15px] before:top-0 before:w-px before:bg-border",
          last ? "before:h-1/2" : "before:bottom-0",
          "after:absolute after:left-[15px] after:top-1/2 after:h-px after:w-2 after:bg-border",
          "group-focus-within/menu-item:!bg-sidebar-row-hover group-hover/menu-item:!bg-sidebar-row-hover",
          "group-has-data-[sidebar=menu-action]/menu-item:pr-2.5",
        )}
        onClick={thread.onSelect}
      >
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <ThreadStatus state={thread.state} />
        <span className="shrink-0 font-mono text-[11px] font-normal tabular-nums text-muted-foreground transition-opacity [@media(hover:hover)]:group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0">
          {thread.time}
        </span>
      </SidebarMenuButton>
    </ThreadMenu>
  );
});
