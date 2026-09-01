import { useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { GitFork, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatView } from "@/components/ChatView";
import { StartSubthreadDialog } from "@/components/StartSubthreadDialog";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import {
  addThreadPane,
  decodeThreadLayout,
  removeThreadPane,
  resizeThreadSplit,
  threadIds,
  threadLeaf,
  type ThreadLayoutNode,
} from "@/lib/thread-layout";
import { workspaceForPath } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Chat } from "@/state/types";

export function ThreadWorkspace({
  routeThread,
  encodedLayout,
  focusedId,
  toolsShown,
  onToolsShownChange,
  onOpenThread,
  onOpenTicket,
  onOpenWorkspace,
  onLayoutChange,
}: {
  routeThread: Chat;
  encodedLayout?: string;
  focusedId?: string;
  toolsShown: Record<string, boolean>;
  onToolsShownChange: (threadId: string, shown: boolean) => void;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onLayoutChange: (parentId: string, layout: ThreadLayoutNode, focus: string, replace?: boolean) => void;
}) {
  const workspaces = useStore((state) => state.workspaces);
  const servers = useStore((state) => state.servers);
  const agents = useStore((state) => state.agents);
  const parentId = routeThread.parentChatId ?? routeThread.id;
  const group = useStore(useShallow((state) =>
    state.chats.filter((chat) => chat.id === parentId || chat.parentChatId === parentId)));
  const parent = group.find((chat) => chat.id === parentId) ?? routeThread;
  const allowed = new Set(group.map((chat) => chat.id));
  const decoded = decodeThreadLayout(encodedLayout);
  const decodedIds = decoded ? threadIds(decoded) : [];
  const layout = decoded && decodedIds.length > 1 && decodedIds.every((id) => allowed.has(id))
    ? decoded
    : threadLeaf(routeThread.id);
  const ids = threadIds(layout);
  const focus = focusedId && ids.includes(focusedId) ? focusedId : ids[ids.length - 1] ?? routeThread.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const bounds = () => {
    const box = rootRef.current?.getBoundingClientRect();
    return { width: box?.width ?? window.innerWidth, height: box?.height ?? window.innerHeight };
  };

  const addBeside = (child: Chat) => {
    const size = bounds();
    onLayoutChange(parent.id, addThreadPane(layout, child.id, size.width, size.height), child.id);
  };

  const remove = (threadId: string) => {
    const next = removeThreadPane(layout, threadId);
    if (!next) return;
    const remaining = threadIds(next);
    if (remaining.length === 1) {
      onOpenThread(remaining[0]!);
      return;
    }
    onLayoutChange(parent.id, next, remaining.includes(focus) ? focus : remaining[remaining.length - 1]!);
  };

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ThreadSplit
        node={layout}
        chats={group}
        workspaces={workspaces}
        servers={servers}
        agents={agents}
        parent={parent}
        focusedId={focus}
        toolsShown={toolsShown}
        onFocus={(id) => onLayoutChange(parent.id, layout, id, true)}
        onResize={(splitId, ratio) => onLayoutChange(
          parent.id,
          resizeThreadSplit(layout, splitId, ratio),
          focus,
          true,
        )}
        onClose={ids.length > 1 ? remove : undefined}
        onStartSubthread={() => setSpawnOpen(true)}
        onToolsShownChange={onToolsShownChange}
        onOpenThread={onOpenThread}
        onOpenTicket={onOpenTicket}
        onOpenWorkspace={onOpenWorkspace}
      />

      <StartSubthreadDialog
        parent={parent}
        open={spawnOpen}
        onOpenChange={setSpawnOpen}
        onStarted={(child, beside) => beside ? addBeside(child) : onOpenThread(child.id)}
      />
    </div>
  );
}

function ThreadSplit({
  node,
  chats,
  workspaces,
  servers,
  agents,
  parent,
  focusedId,
  toolsShown,
  onFocus,
  onResize,
  onClose,
  onStartSubthread,
  onToolsShownChange,
  onOpenThread,
  onOpenTicket,
  onOpenWorkspace,
}: {
  node: ThreadLayoutNode;
  chats: Chat[];
  workspaces: ReturnType<typeof useStore.getState>["workspaces"];
  servers: ReturnType<typeof useStore.getState>["servers"];
  agents: ReturnType<typeof useStore.getState>["agents"];
  parent: Chat;
  focusedId: string;
  toolsShown: Record<string, boolean>;
  onFocus: (id: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onClose?: (id: string) => void;
  onStartSubthread: () => void;
  onToolsShownChange: (threadId: string, shown: boolean) => void;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  if (node.type === "thread") {
    const chat = chats.find((entry) => entry.id === node.threadId);
    if (!chat) return null;
    const focused = chat.id === focusedId;
    const child = Boolean(chat.parentChatId);
    const end: ReactNode = (
      <>
        {!child && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Start subthread" onClick={onStartSubthread}>
                <GitFork />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start subthread</TooltipContent>
          </Tooltip>
        )}
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Close ${chat.title} pane`} onClick={() => onClose(chat.id)}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close pane</TooltipContent>
          </Tooltip>
        )}
      </>
    );
    return (
      <section
        aria-label={`${chat.title} thread pane`}
        className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden", focused && "bg-accent/5")}
        onPointerDown={() => {
          if (!focused) onFocus(chat.id);
        }}
      >
        <ChatView
          chat={chat}
          focused={focused}
          headerEnd={end}
          toolsShown={toolsShown[chat.id] === true}
          onToolsShownChange={(shown) => onToolsShownChange(chat.id, shown)}
          crumbs={child ? childCrumbs(chat, parent, workspaces, servers, onOpenThread) : undefined}
          persona={agents.find((agent) => agent.id === chat.agentId && agent.serverId === chat.serverId)}
          onOpenTicket={onOpenTicket}
          onOpenThread={onOpenThread}
          onOpenWorkspace={onOpenWorkspace}
        />
      </section>
    );
  }

  const firstId = `${node.id}-first`;
  const secondId = `${node.id}-second`;
  const shared = {
    chats,
    workspaces,
    servers,
    agents,
    parent,
    focusedId,
    toolsShown,
    onFocus,
    onResize,
    onClose,
    onStartSubthread,
    onToolsShownChange,
    onOpenThread,
    onOpenTicket,
    onOpenWorkspace,
  };
  return (
    <ResizablePanelGroup
      id={`thread-split-${node.id}`}
      orientation={node.direction}
      defaultLayout={{ [firstId]: node.ratio * 100, [secondId]: (1 - node.ratio) * 100 }}
      className="min-h-0 min-w-0 flex-1"
      onLayoutChanged={(next, meta) => {
        if (!meta.isUserInteraction || typeof next[firstId] !== "number") return;
        onResize(node.id, next[firstId] / 100);
      }}
    >
      <ResizablePanel id={firstId} minSize="16rem" className="flex min-h-0 min-w-0 overflow-hidden">
        <ThreadSplit node={node.first} {...shared} />
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize thread panes" />
      <ResizablePanel id={secondId} minSize="16rem" className="flex min-h-0 min-w-0 overflow-hidden">
        <ThreadSplit node={node.second} {...shared} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function childCrumbs(
  child: Chat,
  parent: Chat,
  workspaces: ReturnType<typeof useStore.getState>["workspaces"],
  servers: ReturnType<typeof useStore.getState>["servers"],
  onOpenThread: (id: string) => void,
) {
  const workspace = workspaces[workspaceForPath(parent.cwd, workspaces)];
  const server = servers.find((entry) => entry.id === parent.serverId);
  return [
    {
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <WorkspaceMark home={!workspace} workspace={workspace} server={server} size="sm" />
          <span className="truncate">{parent.title}</span>
        </span>
      ),
      onClick: () => onOpenThread(parent.id),
    },
    { label: child.title },
  ];
}
