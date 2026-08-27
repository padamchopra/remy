import { useEffect, useState } from "react";
import { Bot, Plus, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AvatarBadge } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentMark } from "@/components/AgentAvatar";
import { AgentSettings } from "@/components/AgentSettings";
import { ChatView } from "@/components/ChatView";
import { PaneHeader } from "@/components/PaneHeader";
import { apiError } from "@/lib/api-error";
import { agentConversation, availableAgentServers } from "@/lib/inbox";
import { plainText } from "@/lib/path";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Agent, Chat } from "@/state/types";

/// The inbox: your agents, and the conversation with the one you picked.
///
/// The roster is a list in this pane rather than in the sidebar. The sidebar
/// holds your threads in every section — they are the work, and one is always
/// one click away — so a second list there would have had to push them aside.
export function Inbox({
  agents,
  selected,
  missing,
  loading,
  onSelectAgent,
  onNewAgent,
  creatingAgent,
  onOpenTicket,
  onOpenThread,
  onOpenWorkspace,
  onDeleted,
}: {
  agents: Agent[];
  /// The agent the URL named, when it names one of these.
  selected?: Agent;
  /// The handle it named when it names nobody, so the pane can say so.
  missing?: string;
  loading: boolean;
  onSelectAgent: (handle: string) => void;
  onNewAgent: () => void;
  creatingAgent: boolean;
  onOpenTicket: (key: string) => void;
  onOpenThread: (id: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onDeleted: () => void;
}) {
  const dms = useStore((s) => s.dms);
  const servers = useStore((s) => s.servers);
  const preferenceOrder = useStore((s) => s.settings?.devicePreferenceOrder);
  const online = availableAgentServers(servers, preferenceOrder).length > 0;

  return (
    <main className="flex min-w-0 flex-1">
      <nav
        aria-label="Agents"
        className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar/40"
      >
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-0.5 p-2">
            {agents.map((agent) => {
              return (
                <li key={agent.id}>
                  <AgentRow
                    agent={agent}
                    active={selected?.id === agent.id}
                    dm={agentConversation(agent.id, dms, servers, preferenceOrder)}
                    online={online}
                    onSelect={() => onSelectAgent(agent.handle)}
                  />
                </li>
              );
            })}
          </ul>
        </ScrollArea>
        <div className="border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            disabled={creatingAgent}
            onClick={onNewAgent}
          >
            <Plus />
            New agent
          </Button>
        </div>
      </nav>

      {selected ? (
        <Conversation
          key={selected.id}
          agent={selected}
          onOpenTicket={onOpenTicket}
          onOpenThread={onOpenThread}
          onOpenWorkspace={onOpenWorkspace}
          onDeleted={onDeleted}
        />
      ) : (
        <NobodyPicked
          loading={loading}
          missing={missing}
          agents={agents}
          onNewAgent={onNewAgent}
          busy={creatingAgent}
        />
      )}
    </main>
  );
}

/// One agent in the list: who it is, what it last said, and whether that is
/// something you have read.
function AgentRow({
  agent,
  active,
  dm,
  online,
  onSelect,
}: {
  agent: Agent;
  active: boolean;
  dm?: Chat;
  online: boolean;
  onSelect: () => void;
}) {
  const preview = dm?.preview ? plainText(dm.preview) : agent.role;

  return (
    <button
      type="button"
      data-link
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
      )}
    >
      <span className="relative mt-0.5 shrink-0 overflow-visible">
        <AgentMark agent={agent} className="size-9" />
        {online && (
          <AvatarBadge
            role="img"
            aria-label="Online"
            className="-right-0.5 -bottom-0.5 size-2.5 bg-success ring-sidebar"
          />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm leading-5", dm?.unread && "font-medium")}>
            {agent.name}
          </span>
          {dm?.state === "working" ? (
            <Badge variant="info" className="h-4 px-1.5 text-[10px] leading-none">
              <span className="shimmer">Working</span>
            </Badge>
          ) : dm?.unread ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          ) : null}
        </span>

        {preview && (
          <span
            className={cn(
              "line-clamp-2 text-xs leading-snug",
              dm?.unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {preview}
          </span>
        )}

        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono">@{agent.handle}</span>
        </span>
      </span>
    </button>
  );
}

/// The conversation with one agent.
///
/// It is made the first time you open the agent — a roster nobody has spoken to
/// holds no empty threads — and it runs in your home folder, because work that
/// needs a repository open in front of it is a thread the agent starts.
function Conversation({
  agent,
  onOpenTicket,
  onOpenThread,
  onOpenWorkspace,
  onDeleted,
}: {
  agent: Agent;
  onOpenTicket: (key: string) => void;
  onOpenThread: (id: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onDeleted: () => void;
}) {
  const dms = useStore((s) => s.dms);
  const openDm = useStore((s) => s.openDm);
  const readChat = useStore((s) => s.readChat);
  const settings = useStore((s) => s.settings);
  const servers = useStore((s) => s.servers);
  const [failed, setFailed] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);

  const chat = agentConversation(agent.id, dms, servers, settings?.devicePreferenceOrder);
  const headerLabel = (
    <span className="flex min-w-0 items-center gap-2">
      <AgentMark agent={agent} animate="always" className="size-6" />
      <span className="truncate text-base font-semibold">{agent.name}</span>
    </span>
  );

  useEffect(() => {
    setFailed(undefined);
    void openDm(agent).catch((error) => setFailed(apiError(error)));
  }, [agent.id, openDm]);

  // Opening it is reading it, and it stays read while it is on screen: a reply
  // that lands in front of you was never unread.
  useEffect(() => {
    if (chat?.unread) void readChat(chat.id);
  }, [chat?.id, chat?.unread, readChat]);

  const settingsButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${agent.name} settings`}
          onClick={() => setEditing(true)}
        >
          <Settings2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Agent settings</TooltipContent>
    </Tooltip>
  );

  const sheet = (
    <Sheet open={editing} onOpenChange={setEditing}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{agent.name}</SheetTitle>
          <SheetDescription>What this agent is called and how it thinks.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 px-6 py-6">
            <AgentSettings
              key={agent.id}
              agent={agent}
              defaultGitIdentity={settings?.defaultGitIdentity ?? "author"}
              defaultProvider={settings?.defaultProvider ?? "claude"}
              defaultModel={settings?.defaultModel ?? ""}
              defaultEffort={settings?.defaultEffort ?? ""}
              onDeleted={() => {
                setEditing(false);
                onDeleted();
              }}
            />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );

  if (!chat) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PaneHeader crumbs={[{ label: headerLabel }]}>{settingsButton}</PaneHeader>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Bot /></EmptyMedia>
            <EmptyTitle>{failed ? `Can't open ${agent.name}` : `Opening ${agent.name}…`}</EmptyTitle>
            <EmptyDescription>{failed ?? "One moment."}</EmptyDescription>
          </EmptyHeader>
          {failed && (
            <EmptyContent>
              <Button
                size="sm"
                onClick={() => {
                  setFailed(undefined);
                  void openDm(agent).catch((error) => setFailed(apiError(error)));
                }}
              >
                Try again
              </Button>
            </EmptyContent>
          )}
        </Empty>
        {sheet}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ChatView
        key={chat.id}
        chat={chat}
        onOpenTicket={onOpenTicket}
        onOpenThread={onOpenThread}
        onOpenWorkspace={onOpenWorkspace}
        crumbs={[
          {
            // The list beside this already says which agents there are, so the
            // trail is only the one you are talking to.
            label: headerLabel,
          },
        ]}
        persona={agent}
        headerEnd={settingsButton}
      />
      {sheet}
    </div>
  );
}

/// The right-hand side with nobody picked: a roster still arriving, a handle
/// that names nobody, or no agents to pick from yet.
function NobodyPicked({
  loading,
  missing,
  agents,
  onNewAgent,
  busy,
}: {
  loading: boolean;
  missing?: string;
  agents: Agent[];
  onNewAgent: () => void;
  busy: boolean;
}) {
  const title = loading
    ? "Reading your agents…"
    : missing
      ? `No agent called @${missing}`
      : agents.length > 0
        ? "Pick an agent"
        : "No agents yet";
  const detail = loading
    ? "One moment."
    : missing || agents.length > 0
      ? "Everyone you can talk to is on the left."
      : "Write one to hand work to, then talk to it here.";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PaneHeader crumbs={[{ label: "Inbox" }]} />
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Bot /></EmptyMedia>
          <EmptyTitle className={loading ? "shimmer" : undefined}>{title}</EmptyTitle>
          <EmptyDescription>{detail}</EmptyDescription>
        </EmptyHeader>
        {!loading && !missing && agents.length === 0 && (
          <EmptyContent>
            <Button size="sm" disabled={busy} onClick={onNewAgent}>
              New agent
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </div>
  );
}
