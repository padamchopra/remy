import type { FormEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleStop,
  Copy,
  Folder,
  GitBranch,
  MessagesSquare,
  Square,
  SquareKanban,
  Ticket as TicketIcon,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ComposerMenu } from "@/components/ComposerMenu";
import {
  InlineImageComposer,
  type InlineImageComposerHandle,
  type InlineImageComposerValue,
} from "@/components/InlineImageComposer";
import { ContextMeter } from "@/components/ContextMeter";
import { AgentMark } from "@/components/AgentAvatar";
import { PaneHeader } from "@/components/PaneHeader";
import { ModelPickerButton, useProvider } from "@/components/ModelPicker";
import { ProviderMark } from "@/components/ProviderMark";
import { UserAvatar } from "@/components/UserAvatar";
import { Markdown } from "@/components/Markdown";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { ThreadToolsButton, ThreadToolsSidebar, useThreadTools } from "@/components/SharedBrowser";
import { ThreadToolsLayout } from "@/components/ThreadToolsLayout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/lib/api-error";
import { CLOUD_MODES, cloudModeOf, PERMISSIONS, permissionOf } from "@/lib/chat-options";
import { deviceIcon } from "@/lib/devices";
import { displayPath } from "@/lib/path";
import { workspaceForPath } from "@/lib/projects";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Agent, ArchivedThread, Chat, ChatApproval, ChatQuestionRequest, ConvArtifact, ConvDiffLine, ConvEntry } from "@/state/types";

interface ThreadCheckpoint {
  id: string;
  userText: string;
  assistantText?: string;
}

/// One open chat: its feed, whatever it is waiting on, and the box to answer in.
///
/// The feed is fetched once when the chat opens and patched from then on by the
/// `chat` frames the server pushes as a turn streams.
export function ChatView({
  chat,
  archived,
  headerEnd,
  onOpenTicket,
  onOpenThread,
  onOpenWorkspace,
  onRestored,
  crumbs,
  persona,
}: {
  chat: Chat;
  archived?: ArchivedThread;
  headerEnd?: ReactNode;
  onOpenTicket?: (key: string) => void;
  /// Where a card in the feed goes when a Remy tool made a thread or registered
  /// a workspace. Without these the card is still drawn; it just does not open.
  onOpenThread?: (id: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  onRestored?: (id: string) => void;
  /// Replaces the workspace-and-title trail. An inbox conversation is placed by
  /// who you are talking to, not by the folder it happens to run in.
  crumbs?: { label: ReactNode }[];
  /// Who is answering, when that is somebody rather than a provider. In the
  /// inbox you are talking to an agent, so the feed says its name and wears its
  /// mark; which model is behind it is on the composer, where it is a setting.
  /// It also has no work of its own, so it carries no ticket.
  persona?: Agent;
}) {
  const detail = useStore((s) => s.detail);
  const loading = useStore((s) => s.detailLoading);
  const openChat = useStore((s) => s.openChat);
  const closeChat = useStore((s) => s.closeChat);
  const sendMessage = useStore((s) => s.sendMessage);
  const uploadMessageImage = useStore((s) => s.uploadMessageImage);
  const restoreThread = useStore((s) => s.restoreThread);
  const answerApproval = useStore((s) => s.answerApproval);
  const answerQuestion = useStore((s) => s.answerQuestion);
  const interrupt = useStore((s) => s.interrupt);
  const setChatOptions = useStore((s) => s.setChatOptions);

  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const [draft, setDraft] = useState<InlineImageComposerValue>({
    text: "",
    attachments: [],
    uploading: false,
  });
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<InlineImageComposerHandle>(null);
  const threadTools = useThreadTools(chat.id, chat.serverId, !archived);

  useEffect(() => {
    if (archived) return;
    void openChat(chat.id).catch((caught) => {
      toast.error("Couldn't open that thread", { description: apiError(caught) });
    });
    return () => closeChat();
  }, [chat.id, archived, openChat, closeChat]);

  useEffect(() => {
    composerRef.current?.clear();
    composerRef.current?.focus();
  }, [chat.id]);

  // Which project this chat is in, so the breadcrumb reads as a place rather
  // than a path. A chat started in `~` belongs to no workspace and wears the
  // machine instead.
  const workspace = workspaces[workspaceForPath(chat.cwd, workspaces)];
  const server = servers.find((entry) => entry.id === chat.serverId);
  const cloud = server?.cloud === true;
  const DeviceIcon = deviceIcon(server?.icon);
  // The checkout this thread runs in, which is what names its branch. A thread
  // started in a subdirectory still belongs to the deepest checkout above it,
  // and a checkout Remy added detached has no branch to name at all.
  const tree =
    workspace?.worktrees.find((entry) => entry.path === chat.cwd)
    ?? [...(workspace?.worktrees ?? [])]
      .sort((a, b) => b.path.length - a.path.length)
      .find((entry) => chat.cwd.startsWith(`${entry.path}/`));
  const branch = tree ? (tree.branch ?? "detached") : undefined;

  // The store may still hold the chat that was open a moment ago, so paint from
  // the list row until the fetch for this one lands.
  const open = archived ? {
    id: chat.id,
    serverId: chat.serverId,
    title: archived.title,
    cwd: archived.cwd,
    provider: archived.provider,
    agentId: archived.agentId,
    model: archived.model,
    effort: archived.effort,
    permissionMode: archived.permissionMode,
    state: "idle" as const,
    entries: archived.entries,
    todos: archived.todos,
    context: archived.context,
  } : detail?.id === chat.id ? detail : undefined;
  const state = open?.state ?? chat.state;
  const working = state === "working";
  const conversational = chat.dm === true;
  const entries = open?.entries ?? [];
  const visibleEntries = useMemo(
    () => entries.filter(
      (entry) => conversational
        ? entry.kind === "user" || entry.kind === "assistant"
        : entry.kind !== "thinking" || Boolean(entry.text?.trim()),
    ),
    [conversational, entries],
  );
  const feedItems = useMemo(() => groupToolEntries(visibleEntries), [visibleEntries]);
  const feedTurns = useMemo(() => groupFeedTurns(feedItems), [feedItems]);
  const checkpoints = useMemo(
    () => conversational ? [] : feedTurns.flatMap((turn): ThreadCheckpoint[] => {
      if (!turn.checkpoint) return [];
      let assistantText: string | undefined;
      for (const item of turn.items) {
        if (item.kind === "entry" && item.entry.kind === "assistant" && item.entry.text?.trim()) {
          assistantText = compactCheckpointPreview(item.entry.text);
        }
      }
      return [{
        id: turn.checkpoint.id,
        userText: compactCheckpointPreview(turn.checkpoint.text) || "Your message",
        assistantText,
      }];
    }),
    [conversational, feedTurns],
  );
  const approval = open?.approval;
  const question = open?.question;

  const submit = async () => {
    const trimmed = draft.text.trim();
    if (!trimmed || draft.uploading || busy || archived) return;
    setBusy(true);
    try {
      await sendMessage(trimmed, draft.attachments);
      composerRef.current?.clear();
    } catch (caught) {
      toast.error("Couldn't send that message", { description: apiError(caught) });
    } finally {
      setBusy(false);
      composerRef.current?.focus();
    }
  };

  const unarchive = async () => {
    if (!archived || busy) return;
    setBusy(true);
    try {
      const restored = await restoreThread(archived.id, archived.serverId);
      toast.success("Unarchived the thread.");
      onRestored?.(restored.id);
    } catch (caught) {
      toast.error("Couldn't unarchive that thread", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const permission = cloud ? cloudModeOf(open?.permissionMode) : permissionOf(open?.permissionMode);
  const provider = useProvider(open?.provider ?? chat.provider ?? "claude");
  const asks = provider?.approvals !== false;

  const setOption = async (
    patch: { model?: string | null; effort?: string | null; permissionMode?: string },
    what: string,
  ) => {
    try {
      await setChatOptions(patch);
    } catch (caught) {
      toast.error(`Couldn't change the ${what}`, { description: apiError(caught) });
    }
  };

  const stop = async () => {
    try {
      await interrupt();
    } catch (caught) {
      toast.error("Couldn't stop this turn", { description: apiError(caught) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        crumbs={crumbs ?? [
          {
            label: (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <WorkspaceMark home={!workspace} workspace={workspace} server={server} size="sm" />
                    <span className="truncate">{workspace?.name ?? server?.name ?? "This machine"}</span>
                  </span>
                </TooltipTrigger>
                {/* The path is what the name stands for, so it stays one hover away. */}
                <TooltipContent className="font-mono">{displayPath(chat.cwd)}</TooltipContent>
              </Tooltip>
            ),
          },
          {
            label: persona ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentMark agent={persona} className="size-4" />
                <span className="truncate">{open?.title ?? chat.title}</span>
              </span>
            ) : (open?.title ?? chat.title),
          },
        ]}
      >
        {onOpenTicket && !persona && !archived && <ThreadTicket chatId={chat.id} onOpenTicket={onOpenTicket} />}
        {headerEnd}
        {!conversational && !archived && (
          <ThreadToolsButton
            active={threadTools.active}
            shown={threadTools.shown}
            onClick={() => threadTools.setShown(!threadTools.shown)}
          />
        )}
      </PaneHeader>

      <ThreadToolsLayout
        open={!conversational && !archived && threadTools.shown}
        threadId={chat.id}
        sidebar={(
          <ThreadToolsSidebar
            chatId={chat.id}
            serverId={chat.serverId}
            tabs={threadTools.tabs}
            activeTab={threadTools.activeTab}
            views={threadTools.views}
            setActiveTab={threadTools.setActiveTab}
            setView={threadTools.setView}
            addBrowser={threadTools.addBrowser}
            addAnalytics={threadTools.addAnalytics}
            addPerformance={threadTools.addPerformance}
            canAddBrowser={threadTools.canAddBrowser}
            closeTab={threadTools.closeTab}
            visible={!conversational && !archived && threadTools.shown}
          />
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <ScrollFeed
            key={chat.id}
            chatId={chat.id}
            count={visibleEntries.length}
            working={working}
            checkpoints={checkpoints}
            className="min-h-0 flex-1"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6 [overflow-anchor:none]">
          {loading && visibleEntries.length === 0 ? (
            <FeedSkeleton />
          ) : visibleEntries.length === 0 ? (
            persona ? (
              <AgentConversationStarter persona={persona} provider={provider?.id ?? "claude"} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Wrench />
                  </EmptyMedia>
                  <EmptyTitle>Nothing here yet</EmptyTitle>
                  <EmptyDescription>Send a message to get this thread going.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : (
            feedTurns.map((turn, turnIndex) => {
              const checkpoint = conversational ? undefined : turn.checkpoint;
              const renderItem = (item: FeedItem, sticky = false) => item.kind === "tools" ? (
                <ToolGroup
                  key={`tools:${item.entries[0].id}`}
                  entries={item.entries}
                  onOpenTicket={onOpenTicket}
                  onOpenThread={onOpenThread}
                  onOpenWorkspace={onOpenWorkspace}
                />
              ) : (
                <Entry
                  key={item.entry.id}
                  entry={item.entry}
                  provider={provider?.id ?? "claude"}
                  name={persona?.name ?? provider?.label ?? "Claude"}
                  persona={persona}
                  lead={item.lead}
                  checkpoint={sticky ? checkpoint?.id : undefined}
                />
              );

              return (
                <section
                  key={checkpoint?.id ?? `feed:${turnIndex}`}
                  data-checkpoint-section={checkpoint?.id}
                  className={cn(
                    "flex min-w-0 flex-col gap-4",
                    checkpoint && "group/checkpoint -mb-4",
                  )}
                >
                  {renderItem(turn.items[0], Boolean(checkpoint))}
                  {checkpoint && (
                    <span
                      aria-hidden="true"
                      data-checkpoint-spacer
                      className="pointer-events-none -mt-4 block h-0 shrink-0"
                    />
                  )}
                  {turn.items.slice(1).map((item) => renderItem(item))}
                  {checkpoint && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none -mt-4 block h-4 shrink-0"
                    />
                  )}
                </section>
              );
            })
          )}

          {conversational && working && persona && (
            <Marker role="status" aria-live="polite">
              <MarkerIcon className="size-8">
                <AgentMark agent={persona} className="size-8" />
              </MarkerIcon>
              <MarkerContent className="shimmer">
                <span className="font-medium">{persona.name}</span> is working…
              </MarkerContent>
            </Marker>
          )}

          {approval && (
            <ApprovalCard
              approval={approval}
              onDecide={async (decision) => {
                try {
                  await answerApproval(approval.requestId, decision);
                } catch (caught) {
                  toast.error("Couldn't answer that", { description: apiError(caught) });
                }
              }}
            />
          )}

          {question && (
            <QuestionCard
              request={question}
              onAnswer={async (answers) => {
                try {
                  await answerQuestion(question.requestId, answers);
                } catch (caught) {
                  toast.error("Couldn't answer that", { description: apiError(caught) });
                }
              }}
            />
          )}

          {open?.error && (
            <Card className="gap-2 border-destructive/40 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <CircleAlert className="size-4" />
                This thread hit an error
              </p>
              <p className="text-sm text-muted-foreground">{open.error}</p>
            </Card>
          )}
            </div>
          </ScrollFeed>

          <div className="min-w-0 shrink-0 border-t border-border px-5 py-3">
            {archived && (
              <Item
                variant="outline"
                size="sm"
                className="mx-auto mb-3 w-full max-w-3xl bg-muted/30"
              >
                <ItemMedia variant="icon">
                  <ArchiveRestore />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Unarchive this thread to reply.</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void unarchive()}
                  >
                    <ArchiveRestore />
                    Unarchive
                  </Button>
                </ItemActions>
              </Item>
            )}
            <form
          // The toolbar drops labels by how wide the composer is, not the
          // window: the sidebar takes a fixed slice, so the two differ.
          className="@container mx-auto min-w-0 w-full max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <InputGroup className="items-stretch rounded-xl">
            <InlineImageComposer
              ref={composerRef}
              ariaLabel="Message"
              placeholder={
                archived
                  ? "Unarchive to reply."
                  : persona
                    ? `Message ${persona.name}.`
                    : "Reply, or ask for the next change."
              }
              disabled={Boolean(archived)}
              onChange={setDraft}
              onSubmit={() => void submit()}
              onUpload={uploadMessageImage}
              onError={(message) => toast.error(message)}
            />
            {/* The controls share one strip while they fit. At the smallest
                split-pane widths, the critical action cluster wraps intact
                instead of spilling beyond the composer. */}
            <InputGroupAddon align="block-end" className="min-w-0 flex-wrap gap-1">
              {cloud ? (
                <InputGroupText>Cursor Cloud default</InputGroupText>
              ) : (
                <ModelPickerButton
                  variant="composer"
                  value={{ provider: provider?.id ?? "claude", model: open?.model ?? "", effort: open?.effort ?? "" }}
                  onlyProvider={provider?.id ?? "claude"}
                  disabled={!open || Boolean(archived)}
                  title={working ? "Applies to the next turn." : undefined}
                  onPick={(next) =>
                    void setOption(
                      { model: next.model || null, effort: next.effort ?? null },
                      "model",
                    )
                  }
                />
              )}
              <ComposerMenu
                icon={permission.icon}
                label={permission.label}
                value={permission.value}
                disabled={!open || Boolean(archived)}
                title={
                  working
                    ? "Applies to the next turn."
                    : asks
                      ? undefined
                      : `${provider?.label ?? "This provider"} can't stop to ask, so Ask keeps it read-only.`
                }
                onChange={(value) => void setOption({ permissionMode: value }, "permission mode")}
                options={cloud ? CLOUD_MODES : PERMISSIONS}
              />

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {/* Where a thread runs is fixed when it starts, so these read
                    rather than offer. */}
                {!conversational && (
                  <InputGroupText title={displayPath(chat.cwd)} className="hidden @3xl:flex">
                    <DeviceIcon />
                    {server?.name ?? "This machine"}
                  </InputGroupText>
                )}
                {branch && (
                  <BranchName branch={branch} />
                )}
                <ContextMeter context={open?.context} />
                {working && (
                  <InputGroupButton type="button" onClick={() => void stop()}>
                    <Square />
                    Stop
                  </InputGroupButton>
                )}
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  className="rounded-full"
                  disabled={!draft.text.trim() || draft.uploading || busy || Boolean(archived)}
                  aria-label="Send"
                >
                  <ArrowUp />
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
          {!asks && open?.permissionMode === "default" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {provider?.label ?? "This provider"} can't stop to ask, so Ask keeps it read-only.
            </p>
          )}
            </form>
          </div>
        </div>
      </ThreadToolsLayout>
    </div>
  );
}

function BranchName({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let copiedSynchronously = false;
    try {
      const input = document.createElement("textarea");
      input.value = branch;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.append(input);
      input.focus();
      input.select();
      input.setSelectionRange(0, branch.length);
      copiedSynchronously = document.execCommand("copy");
      input.remove();

      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);

      if (!copiedSynchronously) await navigator.clipboard.writeText(branch);
    } catch {
      if (!copiedSynchronously) {
        setCopied(false);
        toast.error("Couldn't copy the branch", { description: "Your browser blocked clipboard access." });
      }
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <InputGroupButton
          type="button"
          aria-label={`Copy branch ${branch}`}
          className="hidden min-w-0 max-w-40 text-muted-foreground @2xl:flex"
          onClick={() => void copy()}
        >
          <GitBranch />
          <span className="truncate">{branch}</span>
          {copied ? <Check /> : null}
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{copied ? "Copied" : branch}</TooltipContent>
    </Tooltip>
  );
}

/// Keeps the feed pinned to the newest entry, unless you have scrolled up to
/// read something — then it leaves the view where you put it.
function ScrollFeed({
  chatId,
  count,
  working,
  checkpoints,
  className,
  children,
}: {
  chatId: string;
  count: number;
  working: boolean;
  checkpoints: ThreadCheckpoint[];
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const checkpointTarget = useRef<number | undefined>(undefined);
  const checkpointTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [activeCheckpoint, setActiveCheckpoint] = useState(checkpoints.at(-1)?.id);
  const [hoveredCheckpoint, setHoveredCheckpoint] = useState<number | undefined>(undefined);

  useEffect(() => {
    pinned.current = true;
    checkpointTarget.current = undefined;
    setHoveredCheckpoint(undefined);
    clearTimeout(checkpointTimer.current);
  }, [chatId]);

  const refreshScrollState = (viewport: HTMLElement) => {
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (checkpointTarget.current === undefined) {
      pinned.current = distance < 80;
    } else if (Math.abs(viewport.scrollTop - checkpointTarget.current) < 2) {
      checkpointTarget.current = undefined;
      clearTimeout(checkpointTimer.current);
    }

    const sections = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-checkpoint-section]") ?? [])];
    let latestStuck: string | undefined;
    let latestStuckTop: number | undefined;
    const stickyEdge = viewport.scrollTop + 12;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const section of sections) {
      const message = section.querySelector<HTMLElement>("[data-checkpoint-message]");
      if (!message) continue;
      const content = message.querySelector<HTMLElement>("[data-slot=message-content]");
      const avatar = message.querySelector<HTMLElement>("[data-slot=message-avatar]");
      const header = message.querySelector<HTMLElement>("[data-slot=message-header]");
      const bubble = message.querySelector<HTMLElement>("[data-slot=bubble-content]");
      const footer = message.querySelector<HTMLElement>("[data-slot=message-footer]");
      const spacer = section.querySelector<HTMLElement>("[data-checkpoint-spacer]");
      if (!content || !bubble || !spacer) continue;

      if (!section.style.getPropertyValue("--checkpoint-natural-message-height")) {
        const bubbleStyle = window.getComputedStyle(bubble);
        const lineHeight = Number.parseFloat(bubbleStyle.lineHeight);
        const compactBubbleHeight = lineHeight
          + Number.parseFloat(bubbleStyle.paddingTop)
          + Number.parseFloat(bubbleStyle.paddingBottom)
          + Number.parseFloat(bubbleStyle.borderTopWidth)
          + Number.parseFloat(bubbleStyle.borderBottomWidth);
        section.style.setProperty("--checkpoint-natural-message-height", `${message.getBoundingClientRect().height}px`);
        section.style.setProperty("--checkpoint-natural-bubble-height", `${bubble.getBoundingClientRect().height}px`);
        section.style.setProperty("--checkpoint-natural-header-height", `${header?.getBoundingClientRect().height ?? 0}px`);
        section.style.setProperty("--checkpoint-natural-footer-height", `${footer?.getBoundingClientRect().height ?? 0}px`);
        section.style.setProperty("--checkpoint-natural-gap", window.getComputedStyle(content).rowGap);
        section.style.setProperty("--checkpoint-compact-bubble-height", `${compactBubbleHeight}px`);
      }

      const stuck = section.offsetTop <= stickyEdge;
      const naturalMessageHeight = Number.parseFloat(section.style.getPropertyValue("--checkpoint-natural-message-height"));
      const naturalBubbleHeight = Number.parseFloat(section.style.getPropertyValue("--checkpoint-natural-bubble-height"));
      const naturalHeaderHeight = Number.parseFloat(section.style.getPropertyValue("--checkpoint-natural-header-height"));
      const naturalFooterHeight = Number.parseFloat(section.style.getPropertyValue("--checkpoint-natural-footer-height"));
      const naturalGap = Number.parseFloat(section.style.getPropertyValue("--checkpoint-natural-gap"));
      const compactBubbleHeight = Number.parseFloat(section.style.getPropertyValue("--checkpoint-compact-bubble-height"));
      const collapseDistance = Math.max(0, naturalMessageHeight - compactBubbleHeight);
      const progress = reducedMotion
        ? (stuck ? 1 : 0)
        : Math.max(0, Math.min(1, (stickyEdge - section.offsetTop) / Math.max(1, collapseDistance)));
      const remaining = 1 - progress;

      content.style.gap = `${naturalGap * remaining}px`;
      if (header) {
        header.style.height = `${naturalHeaderHeight * remaining}px`;
        header.style.opacity = `${remaining}`;
      }
      bubble.style.height = `${compactBubbleHeight + (naturalBubbleHeight - compactBubbleHeight) * remaining}px`;
      if (footer) footer.style.height = `${naturalFooterHeight * remaining}px`;
      message.style.setProperty("--checkpoint-avatar-y", `${-32 * remaining}px`);
      if (avatar?.hasAttribute("data-sequential-avatar")) avatar.style.opacity = `${progress}`;
      spacer.style.height = `${Math.max(0, naturalMessageHeight - message.getBoundingClientRect().height)}px`;
      section.toggleAttribute("data-stuck", stuck);
      message.toggleAttribute("data-stuck", stuck);
      message.toggleAttribute("data-compacted", progress >= 0.999);
      if (stuck) {
        latestStuck = section.dataset.checkpointSection;
        latestStuckTop = section.offsetTop;
      }
    }

    let latestVisibleMessage: string | undefined;
    let firstVisibleBubbleTop: number | undefined;
    const viewportRect = viewport.getBoundingClientRect();
    for (const section of sections) {
      if (section.hasAttribute("data-stuck")) continue;
      const bubble = section.querySelector<HTMLElement>("[data-slot=bubble-content]");
      if (!bubble) continue;
      const bubbleRect = bubble.getBoundingClientRect();
      if (bubbleRect.top < viewportRect.bottom && bubbleRect.bottom > viewportRect.top) {
        firstVisibleBubbleTop ??= bubbleRect.top;
        latestVisibleMessage = section.dataset.checkpointSection;
      }
    }

    const visibleBubbleDepth = firstVisibleBubbleTop === undefined
      ? 0
      : Math.max(0, viewportRect.bottom - firstVisibleBubbleTop);
    const stickyTravel = latestStuckTop === undefined
      ? 0
      : Math.max(0, stickyEdge - latestStuckTop);
    const scrollOutDistance = Math.min(visibleBubbleDepth, stickyTravel);
    for (const section of sections) {
      const message = section.querySelector<HTMLElement>("[data-checkpoint-message]");
      if (!message) continue;
      const current = section.hasAttribute("data-stuck") && section.dataset.checkpointSection === latestStuck;
      message.toggleAttribute("data-sticky-active", current);
      message.style.setProperty("--checkpoint-reminder-y", `${current ? -scrollOutDistance : 0}px`);
    }
    setActiveCheckpoint(latestVisibleMessage ?? latestStuck);
  };

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!viewport) return;
    const content = viewport.firstElementChild;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pinned.current && checkpointTarget.current === undefined) {
          viewport.scrollTop = viewport.scrollHeight;
        }
        refreshScrollState(viewport);
      });
    };
    const observer = new ResizeObserver(refresh);
    if (content) observer.observe(content);
    refresh();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [chatId, count, working]);

  const scrollToCheckpoint = (id: string) => {
    pinned.current = false;
    setActiveCheckpoint(id);
    const root = rootRef.current;
    const viewport = root?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    const section = [...(root?.querySelectorAll<HTMLElement>("[data-checkpoint-section]") ?? [])]
      .find((candidate) => candidate.dataset.checkpointSection === id);
    if (!viewport || !section) return;
    const target = Math.max(0, section.offsetTop - 12);
    checkpointTarget.current = target;
    clearTimeout(checkpointTimer.current);
    checkpointTimer.current = setTimeout(() => {
      checkpointTarget.current = undefined;
    }, 1_500);
    viewport.scrollTo({
      top: target,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const resolvedHoveredCheckpoint = hoveredCheckpoint !== undefined && hoveredCheckpoint < checkpoints.length
    ? hoveredCheckpoint
    : undefined;
  const hoveredItem = resolvedHoveredCheckpoint === undefined
    ? undefined
    : checkpoints[resolvedHoveredCheckpoint];
  const activeCheckpointIndex = checkpoints.findIndex((checkpoint) => checkpoint.id === activeCheckpoint);
  const checkpointTop = (index: number) => checkpoints.length <= 1
    ? 0
    : (index / (checkpoints.length - 1)) * 100;
  const checkpointFromPointer = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (checkpoints.length <= 1 || rect.height <= 0) return 0;
    const progress = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    return Math.round(progress * (checkpoints.length - 1));
  };
  const moveHoveredCheckpoint = (event: KeyboardEvent<HTMLElement>, delta: number) => {
    event.preventDefault();
    setHoveredCheckpoint((current) => Math.max(0, Math.min(checkpoints.length - 1, (current ?? 0) + delta)));
  };

  return (
    <div className={cn("relative", className)}>
      <ScrollArea
        ref={rootRef}
        className="h-full"
        onClickCapture={(event) => {
          if (!(event.target instanceof Element)) return;
          const message = event.target.closest<HTMLElement>("[data-scroll-checkpoint]");
          if (!message) return;
          const selection = window.getSelection();
          if (event.detail > 0 && selection && !selection.isCollapsed && message.contains(selection.anchorNode)) return;
          const checkpoint = message.dataset.scrollCheckpoint;
          if (checkpoint) scrollToCheckpoint(checkpoint);
        }}
        onScrollCapture={(event) => {
          const viewport = event.target as HTMLElement;
          if (viewport?.dataset?.slot !== "scroll-area-viewport") return;
          refreshScrollState(viewport);
        }}
      >
        {children}
      </ScrollArea>

      {checkpoints.length > 0 && (
        <nav
          aria-label="Thread checkpoints"
          className="pointer-events-none absolute inset-y-0 left-0 z-30 w-14"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-link
            aria-label={`Go to checkpoint ${(resolvedHoveredCheckpoint ?? Math.max(0, activeCheckpointIndex)) + 1}`}
            className="pointer-events-auto absolute top-1/2 left-3 h-auto w-10 -translate-y-1/2 rounded-sm bg-transparent p-0 hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/70"
            style={{
              height: `min(${Math.max(1, (checkpoints.length - 1) * 8)}px, calc(100vh - 18rem))`,
              width: hoveredItem ? "22rem" : 40,
            }}
            onBlur={() => setHoveredCheckpoint(undefined)}
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("[data-checkpoint-preview]")) return;
              const index = checkpointFromPointer(event);
              const checkpoint = checkpoints[index];
              if (checkpoint) scrollToCheckpoint(checkpoint.id);
            }}
            onFocus={() => {
              setHoveredCheckpoint((current) => current ?? Math.max(0, activeCheckpointIndex));
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") moveHoveredCheckpoint(event, 1);
              else if (event.key === "ArrowUp") moveHoveredCheckpoint(event, -1);
              else if (event.key === "Home") {
                event.preventDefault();
                setHoveredCheckpoint(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setHoveredCheckpoint(checkpoints.length - 1);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (hoveredItem) scrollToCheckpoint(hoveredItem.id);
              }
            }}
            onMouseLeave={() => setHoveredCheckpoint(undefined)}
            onMouseMove={(event) => setHoveredCheckpoint(checkpointFromPointer(event))}
          >
            {checkpoints.map((checkpoint, index) => {
              const active = checkpoint.id === activeCheckpoint;
              const hoverDistance = resolvedHoveredCheckpoint === undefined
                ? undefined
                : Math.abs(index - resolvedHoveredCheckpoint);
              return (
                <span
                  key={checkpoint.id}
                  aria-hidden="true"
                  data-active={active ? "true" : "false"}
                  data-checkpoint-index={index}
                  className={cn(
                    "pointer-events-none absolute left-0 h-0.5 w-2 -translate-y-1/2 rounded-full bg-foreground/25 transition-[background-color,width] duration-150 motion-reduce:transition-none",
                    hoverDistance === 0 && "bg-foreground/65",
                    active && "bg-foreground/85",
                  )}
                  style={{
                    top: `${checkpointTop(index)}%`,
                    width: hoverDistance === 0 ? 24 : hoverDistance === 1 ? 16 : hoverDistance === 2 ? 10 : 8,
                  }}
                />
              );
            })}
            {hoveredItem && resolvedHoveredCheckpoint !== undefined && (
              <Card
                data-checkpoint-preview
                className="pointer-events-auto absolute left-8 z-10 w-80 cursor-text select-text gap-1 rounded-xl border-border/60 bg-popover/95 p-3 text-left text-popover-foreground shadow-xl shadow-black/20 backdrop-blur-md"
                onMouseMove={(event) => event.stopPropagation()}
                style={{
                  top: `${checkpointTop(resolvedHoveredCheckpoint)}%`,
                  transform: resolvedHoveredCheckpoint === 0
                    ? "translateY(0)"
                    : resolvedHoveredCheckpoint === checkpoints.length - 1
                      ? "translateY(-100%)"
                      : "translateY(-50%)",
                }}
              >
                <span className="block max-w-full truncate text-sm font-medium leading-5">
                  {hoveredItem.userText}
                </span>
                {hoveredItem.assistantText && (
                  <span className="line-clamp-3 whitespace-normal text-sm leading-5 text-muted-foreground">
                    {hoveredItem.assistantText}
                  </span>
                )}
              </Card>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}

const MODEL_SWITCH = /^—\s*moved to\s+(.+?)\s*—$/i;

function modelSwitch(entry: ConvEntry): { provider: string; label: string } | undefined {
  if (entry.kind !== "assistant") return undefined;
  const label = entry.text?.match(MODEL_SWITCH)?.[1]?.trim();
  if (!label) return undefined;
  const provider = PROVIDERS.find((candidate) => candidate.label.toLowerCase() === label.toLowerCase());
  return { provider: provider?.id ?? label.toLowerCase(), label };
}

/// Who an entry belongs to. Provider changes are feed state, not a reply, so
/// the next real answer still introduces the agent that wrote it.
function speaker(entry: ConvEntry): "you" | "agent" | "system" {
  if (modelSwitch(entry)) return "system";
  return entry.kind === "user" ? "you" : "agent";
}

type FeedItem =
  | { kind: "entry"; entry: ConvEntry; lead: boolean }
  | { kind: "tools"; entries: ConvEntry[] };

interface FeedTurn {
  checkpoint?: ConvEntry;
  items: FeedItem[];
}

function compactCheckpointPreview(text: string | null | undefined): string {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

/// Consecutive tool calls are one passage in the conversation. Prose starts a
/// new passage, so diagnostics never swallow the words that explain them.
function groupToolEntries(entries: ConvEntry[]): FeedItem[] {
  const items: FeedItem[] = [];

  entries.forEach((entry, index) => {
    if (entry.kind === "tool") {
      const previous = items.at(-1);
      if (previous?.kind === "tools") previous.entries.push(entry);
      else items.push({ kind: "tools", entries: [entry] });
      return;
    }

    items.push({
      kind: "entry",
      entry,
      lead: index === 0 || speaker(entries[index - 1]) !== speaker(entry),
    });
  });

  return items;
}

/// A user request and everything that follows it form one turn. Keeping the
/// real request inside that section lets CSS sticky hold it until the next turn
/// arrives, which gives the browser ownership of the header handoff.
function groupFeedTurns(items: FeedItem[]): FeedTurn[] {
  const turns: FeedTurn[] = [];

  for (const item of items) {
    if (item.kind === "entry" && item.entry.kind === "user") {
      turns.push({ checkpoint: item.entry, items: [item] });
      continue;
    }

    const current = turns.at(-1);
    if (current) current.items.push(item);
    else turns.push({ items: [item] });
  }

  return turns;
}

/// `lead` marks the first entry of a run. Only that one wears the avatar and
/// the name; the rest keep the column so the run stays aligned, and say nothing
/// a reader already knows.
function Entry({
  entry,
  lead,
  provider,
  name,
  persona,
  checkpoint,
}: {
  entry: ConvEntry;
  lead: boolean;
  provider: string;
  name: string;
  persona?: Agent;
  checkpoint?: string;
}) {
  const switched = modelSwitch(entry);
  if (switched) {
    return (
      <Marker variant="separator" className="py-1">
        <MarkerContent className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span>Switched to</span>
          <ProviderMark provider={switched.provider} className="size-3.5" />
          <span>{switched.label}</span>
        </MarkerContent>
      </Marker>
    );
  }

  if (entry.kind === "user") {
    return (
      <Message
        align="end"
        data-checkpoint-message={checkpoint}
        className={cn(
          checkpoint !== undefined && [
            "sticky top-3 z-10 isolate translate-y-[var(--checkpoint-reminder-y)]",
            "before:pointer-events-none before:absolute before:-inset-x-5 before:-top-3 before:-bottom-6 before:-z-10 before:bg-linear-to-b before:from-background before:via-background/95 before:via-60% before:to-transparent before:opacity-0 before:transition-opacity before:duration-200 before:content-[''] motion-reduce:before:transition-none",
            "data-[sticky-active]:z-20 data-[sticky-active]:before:opacity-100",
          ],
        )}
      >
        {/* The slot is its own muted disc at `min-w-8`. A smaller avatar inside
            leaves that disc showing as a ring, so the avatar fills it and the
            slot carries no colour of its own. */}
        <MessageAvatar
          data-sequential-avatar={!lead ? "" : undefined}
          className={cn(
            "bg-transparent translate-y-[var(--checkpoint-avatar-y)]!",
            !lead && "opacity-0",
          )}
        >
          <UserAvatar />
        </MessageAvatar>
        <MessageContent>
          {lead && (
            <MessageHeader className="max-h-5 overflow-hidden">
              You
            </MessageHeader>
          )}
          <Bubble align="end">
            <BubbleContent
              asChild={checkpoint !== undefined}
              className="whitespace-pre-wrap transition-[background-color] duration-150 group-data-[compacted]/message:truncate group-data-[stuck]/message:bg-primary/45! group-data-[stuck]/message:backdrop-blur-sm motion-reduce:transition-none"
            >
              {checkpoint !== undefined ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-link
                  data-slot="bubble-content"
                  data-scroll-checkpoint={checkpoint}
                  aria-label="Scroll to this message"
                  className="h-auto min-h-0 max-w-full min-w-0 justify-start whitespace-pre-wrap font-normal motion-reduce:transition-none!"
                >
                  {entry.text}
                </Button>
              ) : entry.text}
            </BubbleContent>
          </Bubble>
          {entry.text && (
            <MessageFooter className="max-h-6 overflow-hidden group-data-[stuck]/message:opacity-0">
              <CopyPrompt text={entry.text} />
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    );
  }

  if (entry.kind === "assistant") {
    return (
      <Message>
        <AgentAvatar provider={provider} persona={persona} lead={lead} />
        <MessageContent>
          {/* The provider, not the model: which Claude or which Codex answered
              is a setting of the thread, and it is on the toolbar. */}
          {lead && <MessageHeader>{name}</MessageHeader>}
          <Bubble variant="ghost">
            <BubbleContent>
              <Markdown text={entry.text ?? ""} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  if (entry.kind === "thinking") {
    return (
      <Message>
        <AgentAvatar provider={provider} persona={persona} lead={lead} />
        <MessageContent>
          {lead && <MessageHeader>{name}</MessageHeader>}
          <Bubble variant="ghost">
            <BubbleContent className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground italic">
              {entry.text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  return null;
}

/// An agent's empty conversation already reads like the first exchange: they
/// introduce themselves in the same column their real replies will use, and
/// the composer immediately below is the answer.
function AgentConversationStarter({ persona, provider }: { persona: Agent; provider: string }) {
  return (
    <Empty className="items-stretch justify-start p-0 text-left md:p-0">
      <Message>
        <AgentAvatar provider={provider} persona={persona} lead />
        <MessageContent>
          <MessageHeader>{persona.name}</MessageHeader>
          <Bubble variant="ghost">
            <BubbleContent>What are we working on?</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </Empty>
  );
}

const ARTIFACT_ICON = {
  ticket: SquareKanban,
  thread: MessagesSquare,
  workspace: Folder,
} as const;

/// What a Remy tool just made, as a thing rather than a sentence.
///
/// A tool result is a line of prose the reader has to parse; a ticket is
/// something you open. The card carries what it is and what it is called, and
/// it opens the thing itself where this feed knows how to.
function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: ConvArtifact;
  onOpen?: () => void;
}) {
  const Icon = ARTIFACT_ICON[artifact.kind];
  const body = (
    <>
      <ItemMedia variant="icon" className="size-7">
        <Icon className="size-3.5" />
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle className="truncate">{artifact.title}</ItemTitle>
        <ItemDescription className="flex items-center gap-1.5 truncate">
          {artifact.key && <span className="font-mono">{artifact.key}</span>}
          {artifact.detail}
        </ItemDescription>
      </ItemContent>
      {onOpen && (
        <ItemActions>
          <ArrowUpRight className="size-4 text-muted-foreground" />
        </ItemActions>
      )}
    </>
  );

  if (!onOpen) {
    return <Item variant="outline" size="sm">{body}</Item>;
  }

  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className="w-full text-left hover:bg-accent"
    >
      <button type="button" data-link onClick={onOpen}>{body}</button>
    </Item>
  );
}

/// `MessageAvatar` is the slot; `Avatar` is what goes in it, which is what
/// gives the mark its circle and keeps it from stretching.
function AgentAvatar({
  provider,
  persona,
  lead,
}: {
  provider: string;
  persona?: Agent;
  lead: boolean;
}) {
  const claude = provider === "claude";
  return (
    <MessageAvatar className={cn("bg-transparent", !lead && "invisible")}>
      {/* An agent wears the mark it wears in the inbox, so a run of messages
          is recognised rather than read. Everywhere else it is the provider's
          own disc: its mark on a wash of its own colour, the way the
          workspace marks do. */}
      {persona ? (
        <AgentMark agent={persona} className="size-8" />
      ) : (
        <Avatar>
          <AvatarFallback className={claude ? "bg-claude/15" : "bg-foreground/10"}>
            <ProviderMark provider={provider} className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </MessageAvatar>
  );
}

/// Puts a prompt back on the clipboard, for saying nearly the same thing again.
/// The tick is the confirmation — a toast for every copy would be louder than
/// the action deserves.
function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // A browser that refuses the clipboard says nothing useful, so say the
      // one thing that helps.
      toast.error("Couldn't copy that", { description: "Your browser blocked clipboard access." });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Copy prompt"
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy prompt"}</TooltipContent>
    </Tooltip>
  );
}

function ToolEntry({ entry }: { entry: ConvEntry }) {
  const status = toolStatus(entry);
  const failed = status === "error";
  const stopped = status === "stopped";
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(entry.output || entry.diff?.length);

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-full min-w-0 justify-start rounded-lg px-2 font-normal hover:bg-transparent"
      aria-expanded={expandable ? expanded : undefined}
    >
      <Wrench data-icon="inline-start" className="shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">{entry.verb ?? entry.tool ?? "Tool"}</span>
      {entry.arg && (
        <span className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground" title={entry.arg}>
          {entry.arg}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {typeof entry.adds === "number" && entry.adds > 0 && (
          <span className="font-mono text-success-foreground">+{entry.adds}</span>
        )}
        {typeof entry.dels === "number" && entry.dels > 0 && (
          <span className="font-mono text-destructive">−{entry.dels}</span>
        )}
        {failed && <Badge variant="destructive">Failed</Badge>}
        {stopped && <Badge variant="secondary">Stopped</Badge>}
        {expandable && (
          <ChevronDown
            data-icon="inline-end"
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        )}
      </span>
    </Button>
  );

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className={cn(
        // `min-w-0` so this can shrink inside the feed's column: without it a
        // long command sets the width and the whole thread scrolls sideways.
        "flex min-w-0 flex-col overflow-hidden rounded-lg border text-xs",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      {expandable ? <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger> : trigger}
      <CollapsibleContent>
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          {entry.diff && entry.diff.length > 0 && <Diff lines={entry.diff} />}
          {entry.output && (
            // Tool output is paths and ref names — long runs with nothing to break
            // on — so it breaks anywhere rather than pushing the card wider.
            <pre className="max-h-56 overflow-auto break-all whitespace-pre-wrap text-muted-foreground">
              {entry.output}
            </pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolGroup({
  entries,
  onOpenTicket,
  onOpenThread,
  onOpenWorkspace,
}: {
  entries: ConvEntry[];
  onOpenTicket?: (key: string) => void;
  onOpenThread?: (id: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = entries.filter((entry) => toolStatus(entry) === "error").length;
  const stopped = entries.filter((entry) => toolStatus(entry) === "stopped").length;

  return (
    // Tool work is the agent's too, so it stays under the agent's text column.
    <div className="flex flex-col gap-1.5 pl-10">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <Marker asChild className="w-fit">
          <CollapsibleTrigger className="group/tool-group rounded-sm py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <MarkerIcon className={failed > 0 ? "text-destructive" : undefined}>
              {failed > 0 ? <CircleAlert /> : stopped > 0 ? <CircleStop /> : <Wrench />}
            </MarkerIcon>
            <MarkerContent>{toolGroupSummary(entries)}</MarkerContent>
            {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
            {stopped > 0 && (
              <Badge variant="secondary">{stopped === 1 ? "Stopped" : `${stopped} stopped`}</Badge>
            )}
            <ChevronDown className="transition-transform group-data-[state=open]/tool-group:rotate-180" />
          </CollapsibleTrigger>
        </Marker>
        <CollapsibleContent className="pt-2">
          <div className="ml-2 flex flex-col gap-1.5 border-l border-border pl-3">
            {entries.map((entry) => <ToolEntry key={entry.id} entry={entry} />)}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {entries.flatMap((entry) => entry.artifacts ?? []).map((artifact, index) => (
        <ArtifactCard
          key={`${artifact.kind}:${artifact.key ?? artifact.id ?? index}`}
          artifact={artifact}
          onOpen={
            artifact.kind === "ticket" && artifact.key && onOpenTicket
              ? () => onOpenTicket(artifact.key!)
              : artifact.kind === "thread" && artifact.id && onOpenThread
                ? () => onOpenThread(artifact.id!)
                : artifact.kind === "workspace" && artifact.id && onOpenWorkspace
                  ? () => onOpenWorkspace(artifact.id!)
                  : undefined
          }
        />
      ))}
    </div>
  );
}

function toolStatus(entry: ConvEntry): ConvEntry["status"] {
  if (entry.status === "stopped") return "stopped";
  if (entry.status === "error" && /(?:\^C|SIGINT)\s*$/i.test(entry.output ?? "")) return "stopped";
  return entry.status;
}

function toolGroupSummary(entries: ConvEntry[]): string {
  const actions = entries.map((entry) => {
    const verb = entry.verb?.toLowerCase() ?? "";
    const tool = entry.tool?.toLowerCase() ?? "";

    if (tool.includes("browser")) return "used the browser";
    if (verb.includes("searched web") || tool.includes("websearch")) return "searched the web";
    if (["edited", "wrote"].some((value) => verb.includes(value)) || /apply_patch|write|edit/.test(tool)) {
      return "edited files";
    }
    if (["read", "searched", "globbed", "listed"].some((value) => verb.includes(value)) || /read|find|search|list|glob/.test(tool)) {
      return "read files";
    }
    if (verb.includes("ran") || /bash|exec|command|shell/.test(tool)) return "ran commands";
    if (verb.includes("skill")) return "loaded instructions";
    if (verb.includes("delegated")) return "delegated work";
    if (verb.includes("fetched")) return "fetched pages";
    return "used tools";
  });
  const unique = [...new Set(actions)];
  const summary = unique.length > 3
    ? `${unique.slice(0, 2).join(", ")}, and ${unique.length - 2} more`
    : unique.join(", ");

  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function Diff({ lines }: { lines: ConvDiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/60 bg-background font-mono text-[11px] leading-5">
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "px-2 whitespace-pre",
            line.kind === "add" && "bg-success/12 text-success-foreground",
            line.kind === "del" && "bg-destructive/10 text-destructive",
            line.kind === "ctx" && "text-muted-foreground",
          )}
        >
          {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          {line.text}
        </div>
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ChatApproval;
  onDecide: (decision: "allow" | "allowAlways" | "deny") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "allow" | "allowAlways" | "deny") => {
    setBusy(true);
    try {
      await onDecide(decision);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 border-warning/50 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{approval.title ?? `${approval.verb} ${approval.arg}`.trim()}</p>
        {approval.reason && <p className="text-xs text-muted-foreground">{approval.reason}</p>}
      </div>
      {approval.plan && (
        <div className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3">
          <Markdown text={approval.plan} className="text-xs" />
        </div>
      )}
      {approval.diff && approval.diff.length > 0 && <Diff lines={approval.diff} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void decide("allow")}>
          Allow
        </Button>
        {approval.allowAlways && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("allowAlways")}>
            Always allow
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("deny")}>
          Deny
        </Button>
      </div>
    </Card>
  );
}

function QuestionCard({
  request,
  onAnswer,
}: {
  request: ChatQuestionRequest;
  onAnswer: (answers: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const items = useMemo(
    () => request.questions.map((question, index) => ({
      name: `question-${index}`,
      required: true,
      choices: question.options.map((option) => ({ value: option.label })),
    })),
    [request.questions],
  );

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const data = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      request.questions.map((question, index) => {
        const values = data
          .getAll(items[index].name)
          .map((value) => String(value).trim())
          .filter(Boolean);
        return [question.question, question.multiSelect ? values.join(", ") : (values[0] ?? "")];
      }),
    );

    setBusy(true);
    try {
      await onAnswer(answers);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-0 border-warning/50 p-4">
      <Questionnaire items={items} shortcuts="letters" onSubmit={(event) => void send(event)}>
        {request.questions.length > 1 && <QuestionnaireProgress />}
        {request.questions.map((question, index) => (
          <QuestionnaireItem
            key={items[index].name}
            name={items[index].name}
            required
            multiple={Boolean(question.multiSelect)}
            disabled={busy}
          >
            <QuestionnaireTitle className="flex flex-col items-start gap-2">
              {question.header && <Badge variant="secondary">{question.header}</Badge>}
              <span>{question.question}</span>
            </QuestionnaireTitle>
            <QuestionnaireDescription>
              {question.multiSelect
                ? "Select all that apply, or write another answer."
                : "Choose one, or write another answer."}
            </QuestionnaireDescription>
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice key={option.label} value={option.label}>
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.description && (
                    <QuestionnaireChoiceDescription>
                      {option.description}
                    </QuestionnaireChoiceDescription>
                  )}
                </QuestionnaireChoice>
              ))}
              <QuestionnaireInput
                aria-label="Another answer"
                placeholder="Type another answer…"
              />
            </QuestionnaireChoices>
            <QuestionnaireError />
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions>
          <QuestionnairePrevious disabled={busy} />
          <QuestionnaireNext disabled={busy} />
          <QuestionnaireSubmit disabled={busy}>Send answer</QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </Card>
  );
}

/// The bridge between a thread and the board, in both directions.
///
/// A thread that is already on a ticket shows its key and opens it. One that is
/// not offers to make a ticket from it — adopting the worktree and branch it is
/// already in rather than opening new ones — or to file it under a ticket that
/// already exists. Neither starts or resumes anything: linking is bookkeeping.
function ThreadTicket({ chatId, onOpenTicket }: { chatId: string; onOpenTicket: (key: string) => void }) {
  const tickets = useStore((s) => s.tickets);
  const loadBoard = useStore((s) => s.loadBoard);
  const ticketFromThread = useStore((s) => s.ticketFromThread);
  const attachThread = useStore((s) => s.attachThread);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBoard().catch(() => {
      // The board is a nicety here; the thread works without one.
    });
  }, [loadBoard]);

  const onTicket = tickets.find((ticket) => ticket.threads.some((link) => link.chatId === chatId));
  const open = tickets.filter((ticket) => ticket.status !== "done" && ticket.status !== "cancelled");

  if (onTicket) return null;

  const create = async () => {
    setBusy(true);
    try {
      const ticket = await ticketFromThread(chatId);
      toast.success(`Tracking as ${ticket.key}`);
      onOpenTicket(ticket.key);
    } catch (error) {
      toast.error("Couldn't make a ticket from this thread", { description: apiError(error) });
    } finally {
      setBusy(false);
    }
  };

  const attach = async (ticketId: string, key: string) => {
    try {
      await attachThread(ticketId, chatId);
      setPicking(false);
      toast.success(`Attached to ${key}`);
    } catch (error) {
      toast.error("Couldn't attach this thread", { description: apiError(error) });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy}>
            <TicketIcon />
            Track
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void create()}>New ticket from this thread</DropdownMenuItem>
          <DropdownMenuItem disabled={open.length === 0} onSelect={() => setPicking(true)}>
            Add to a ticket
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CommandDialog open={picking} onOpenChange={setPicking} title="Add to a ticket">
        <Command>
          <CommandInput placeholder="Find a ticket…" />
          <CommandList>
            <CommandEmpty>No open tickets.</CommandEmpty>
            {open.map((ticket) => (
              <CommandItem
                key={ticket.id}
                value={`${ticket.key} ${ticket.title}`}
                onSelect={() => void attach(ticket.id, ticket.key)}
              >
                <span className="font-mono text-xs text-muted-foreground">{ticket.key}</span>
                <span className="truncate">{ticket.title}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-16 w-2/3 self-end rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-10 w-1/2 rounded-xl" />
    </div>
  );
}
