import { speaker } from "@/lib/thread-message";
import { threadEntryText, visibleThreadEntries } from "@/lib/thread-entry-display";
import { ToolGroup } from "./ThreadTools";
import { workingToolGroupId } from "@/lib/working-tool";
import { PROVIDERS } from "@/lib/providers";
import type { ConvEntry } from "@/state/types";
import { useHubThreadBranch } from "@/lib/hub-thread-branch";
import { ThreadMessageAvatar } from "./ThreadMessageAvatar";
import { BranchName } from "./BranchName";
import { ContextMeter } from "./ContextMeter";
import type { ContextUsage } from "@/state/types";
import { ReplyComposer, replyComposerFrame, replyComposerForm } from "./ReplyComposer";
import { InlineImageComposer, type InlineImageComposerHandle, type InlineImageComposerValue } from "./InlineImageComposer";
import { InputGroupText } from "./ui/input-group";
import { ModelPickerButton } from "./ModelPicker";
import { PermissionPicker } from "./PermissionPicker";
import { permissionOf } from "@/lib/chat-options";
import { Markdown } from "./Markdown";
import { ApprovalDetails } from "./ApprovalDetails";
import { threadModelPicker } from "@/lib/hub-models";
import { useHubResource } from "@/lib/hub-organization";
import type { ModelAccessResponse } from "./HubModelAccess";
import { AvatarFrom } from "./UserAvatar";
import { useHubProfile } from "@/lib/hub-profile";
import { useThreadStarts, retryHubThread, forgetThreadStart } from "@/lib/hub-thread-start";
import { ThreadStartMarker } from "./ThreadStartMarker";
import { FileCode2, MoreHorizontal } from "lucide-react";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { referenceLabel } from "@/lib/pull-request-review";
import type { ChatCodeReference } from "@/state/types";
import { HubThreadWorkbench } from "@/components/HubThreadWorkbench";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { PaneLoading } from "@/components/PaneLoading";
import { PaneHeader } from "@/components/PaneHeader";
import { usePersonalHub } from "@/lib/hub-scope";
import { organizationArtifactRoute, shownArtifacts } from "@/lib/artifact-route";
import { HubThreadComposer, type HubThreadWorkspaceOption } from "./HubThreadComposer";
import { watchHubComputers } from "@/lib/hub-computers";
import { HubNotifications } from "./HubNotifications";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canWriteThread,
  cloudComputerName,
  CURSOR_CLOUD_COMPUTER_ID,
  type HubThread,
  type ThreadMember,
  type ComputerSummary,
} from "@remy/contract";
import { Button } from "@/components/ui/button";

import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  hubRequest,
  hubThreadBase,
  hubThreadPath,
  watchHubThreads,
} from "@/lib/hub-threads";
import { cacheHubThread, cachedHubThread, forgetHubThread } from "@/lib/hub-thread-cache";
import { LinearThreadNotice } from "./LinearConnection";
import type { Route } from "@/lib/route";

type Approval = {
  requestId: string;
  title?: string;
  reason?: string;
  plan?: string;
  tool: string;
  arg?: string;
  allowAlways: boolean;
};
type Question = {
  requestId: string;
  questions: {
    question: string;
    header?: string;
    options?: { label: string }[];
  }[];
};

export default function HubThreads({
  organizationId,
  threadId,
  navigate,
  canManageWorkspaces = false,
  showNavigation = true,
  newThreadSharingControl,
  newThreadVisibility,
  newThreadMessage,
  onNewThreadMessageChange,
  newThreadWorkspaceOptions,
  newThreadWorkspaceId,
  onNewThreadWorkspaceChange,
}: {
  organizationId: string;
  canManageWorkspaces?: boolean;
  showNavigation?: boolean;
  threadId?: string;
  navigate: (route: Route) => void;
  newThreadSharingControl?: ReactNode;
  newThreadVisibility?: "private" | "open";
  newThreadMessage?: string;
  onNewThreadMessageChange?: (message: string) => void;
  newThreadWorkspaceOptions?: HubThreadWorkspaceOption[];
  newThreadWorkspaceId?: string;
  onNewThreadWorkspaceChange?: (workspace: HubThreadWorkspaceOption) => void;
}) {
  const modelAccess = useHubResource<ModelAccessResponse>(organizationId,"/model-access");
  const { profile } = useHubProfile(organizationId);
  const transcript = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const isPersonal = usePersonalHub();
  const remembered = threadId ? cachedHubThread(threadId) : undefined;
  const [threads, setThreads] = useState<HubThread[]>(() => (
    remembered && remembered.organizationId === organizationId ? [remembered.thread] : []
  ));
  const [member, setMember] = useState<ThreadMember>();
  const [loaded, setLoaded] = useState(() => threads.length > 0);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<InlineImageComposerValue>({text:"",attachments:[],uploading:false});
  const editor = useRef<InlineImageComposerHandle>(null);
  const [busy, setBusy] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [computersLoaded, setComputersLoaded] = useState(false);
  const [computerError, setComputerError] = useState("");
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  // Seed once per account. Switching threads keeps the catalogue already in hand.
  useEffect(() => {
    const cached = threadId ? cachedHubThread(threadId) : undefined;
    const seed = cached && cached.organizationId === organizationId ? [cached.thread] : [];
    setThreads(seed);
    setLoaded(seed.length > 0);
    setError("");
    setComputers([]);
    setComputersLoaded(false);
    setComputerError("");
    const offComputers = watchHubComputers(organizationId, (items, stale) => {
      setComputers(items);
      if (!stale) setComputersLoaded(true);
      if (!stale) setComputerError("");
    }, setComputerError);
    const offThreads = watchHubThreads(
      organizationId,
      (items, current) => {
        setThreads(items);
        setMember(current);
        setLoaded(true);
        setError("");
      },
      setError,
    );
    return () => { offComputers(); offThreads(); };
  }, [organizationId]);
  useEffect(() => {
    editor.current?.clear();
    setAnswers({});

  }, [threadId]);
  const starts = useThreadStarts();
  const pending = starts.find(s => !!threadId && s.organizationId === organizationId && (s.requestId === threadId || s.created?.id === threadId));
  const savedThread = threads.find(
    (item) => item.computerId !== "pending" && item.id === threadId,
  );
  const thread: HubThread | undefined = savedThread ?? (pending ? {
    id: pending.requestId, computerId: pending.created?.computerId ?? "pending", stale: false, revision: 0, observedAt: pending.at,
    access: {organizationId, owner: member ?? {id: "pending", label: "You"}, participants: [], visibility: pending.visibility},
    detail: {id: pending.requestId, workspaceId: pending.workspaceId, title: pending.message.slice(0, 200), state: "working", entries: [{id: `u-${pending.requestId}`, kind: "user", text: pending.message}]},
  } : undefined);
  const [liveNotice, setLiveNotice] = useState<string | null>();
  useEffect(() => {
    if (!savedThread || savedThread.access.owner.id !== member?.id) {
      setLiveNotice(undefined);
      return;
    }
    let stop = false;
    void hubRequest<{ notice: string | null }>(`${hubThreadBase(organizationId)}/linear-access`).then((result) => {
      if (!stop) setLiveNotice(result.notice);
    }, () => { if (!stop) setLiveNotice(undefined); });
    return () => { stop = true; };
  }, [savedThread, member?.id, organizationId]);
  const actingComputer = savedThread?.computerId ?? pending?.created?.computerId;
  const actingThread = savedThread?.id ?? pending?.created?.id ?? threadId;
  useEffect(() => {
    if (pending?.phase === "ready" && pending.created && threadId === pending.requestId) {
      navigate({name: "threads", organizationId, threadId: pending.created.id});
    }
    if (pending?.phase === "ready" && savedThread) forgetThreadStart(pending.requestId);
  }, [pending, savedThread, threadId, organizationId, navigate]);
  useEffect(() => {
    followsLatest.current = true;
  }, [threadId]);
  const computer = computers.find((c) => c.computerId === thread?.computerId);
  const rememberedName = remembered && remembered.thread.computerId === thread?.computerId ? remembered.computerName : undefined;
  const computerName = computer?.name ?? rememberedName ?? cloudComputerName(thread?.computerId) ?? pending?.computerName ?? "Computer unavailable";
  useEffect(() => {
    if (!loaded || !threadId || pending) return;
    if (savedThread) cacheHubThread(organizationId, savedThread, { computerName: computer?.name ?? rememberedName, memberId: member?.id });
    else forgetHubThread(threadId);
  }, [loaded, threadId, pending, savedThread, organizationId, computer?.name, rememberedName, member?.id]);
  const cursorCloud = (thread?.computerId ?? pending?.computerId) === CURSOR_CLOUD_COMPUTER_ID;
  const branch = useHubThreadBranch(organizationId, savedThread, computer) ?? pending?.branch;
  const ComputerIcon = deviceIcon((computer?.icon ?? (pending?.computerId?.startsWith("cloud:") ? "cloud" : undefined)) as DeviceIconId);
  const viewerId = member?.id ?? (remembered?.organizationId === organizationId ? remembered.memberId : undefined);
  const writable =
    !!thread && !!viewerId && canWriteThread(thread.access, viewerId);
  const disabled = !!pending || busy || !thread || thread.stale || !writable;
  const path = actingComputer ? hubThreadPath(organizationId, actingComputer, actingThread) : "";
  const visibleEntries = thread?.detail.entries ?? [];
  const entries = visibleThreadEntries(pending && !visibleEntries.some(entry => entry.id === `u-${pending.requestId}`)
    ? [{id: `u-${pending.requestId}`, kind: "user", text: pending.message}, ...visibleEntries]
    : visibleEntries);
  const picker = threadModelPicker({ provider: thread?.detail.provider ?? pending?.provider, model: thread?.detail.model ?? pending?.model, effort: thread?.detail.effort ?? pending?.effort }, computer, modelAccess.value?.providers ?? []);
  const { runtimeProvider, modelProvider, providers } = picker;
  const permission = permissionOf(typeof thread?.detail.permissionMode === "string" ? thread.detail.permissionMode : pending?.permissionMode);
  const approval = thread?.detail.approval as Approval | undefined;
  const question = thread?.detail.question as Question | undefined;
  const act = async (action: string, input: unknown = {}) => {
    setBusy(true);
    setError("");
    try {
      await hubRequest(`${path}/${action}`, "POST", input);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action failed; try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const feed = transcriptItems(entries as unknown as ConvEntry[]);
  const workingTools = workingToolGroupId(
    feed.flatMap((item) => item.kind === "tools" ? item.entries : [item.entry]),
    !pending && thread?.detail.state === "working",
  );
  const open = (_computer: string, id?: string) =>
    navigate({
      name: "threads",
      organizationId,
      threadId: id,
    });
  const send = async () => {
    if (disabled || draft.uploading || !draft.text.trim()) return;
    const accepted = await act("message", {
      text: draft.text,
      messageId: `u-${crypto.randomUUID()}`,
      attachmentIds: draft.attachments.map(image => image.id),
    });
    if (accepted) {
      editor.current?.clear();

    }
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Threads"
    >
      {thread ? (
        <HubThreadWorkbench
          threadId={thread.id}
          title={thread.detail.title || "Thread"}
          state={typeof thread.detail.state === "string" ? thread.detail.state : undefined}
          organizationId={organizationId}
          entries={entries as unknown as ConvEntry[]}
          provider={runtimeProvider}
          working={!pending && thread.detail.state === "working"}
          connected={!thread.stale && computer?.availability !== "offline"}
          revision={thread.revision}
          sidebar={!showNavigation}
          transcriptRef={transcript}
          followsLatest={followsLatest}
          onBack={() => navigate({ name: "threads", organizationId })}
          navigate={navigate}
          notice={<>
            {error && (
              <p role="alert" className="shrink-0 px-4 py-2 text-sm text-destructive">{error}</p>
            )}
            {thread.stale && (
              <p role="status" className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
                {computer?.availability === "offline"
                  ? "This computer is offline; you’re reading its last saved update."
                  : "Remy is reconnecting; you’re reading the last saved update."}
              </p>
            )}
          </>}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Thread details"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>{thread.access.visibility === "private" ? "Private" : isPersonal ? "Only you" : "Shared with your organization"}</DropdownMenuLabel>
                <DropdownMenuLabel className="font-normal text-muted-foreground">Started by {thread.access.owner.label}</DropdownMenuLabel>
                {!isPersonal && thread.access.participants.length > 0 && <DropdownMenuLabel className="font-normal text-muted-foreground">{thread.access.participants.map(person => person.label).join(", ")}</DropdownMenuLabel>}
                <DropdownMenuItem onSelect={() => navigate({ name: "settings", tab: "devices", organizationId })}>
                  <ComputerIcon />{computerName}
                </DropdownMenuItem>
                {!pending && !isPersonal && member?.id === thread.access.owner.id && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={busy || thread.stale} onSelect={() => void act("visibility", { visibility: thread.access.visibility === "private" ? "open" : "private" })}>
                    {thread.access.visibility === "private" ? "Share with organization" : "Make private"}
                  </DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          {({ openLink }) => (
        <>
          {!pending && !!member && !writable && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <Button size="sm" disabled={busy || thread.stale} onClick={() => void act("join")}>Join thread</Button>
          </div>}
          <div
            ref={transcript}
            onScroll={(e) => {
              const node = e.currentTarget;
              followsLatest.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}
            className="min-h-0 flex-1 overflow-auto"
            aria-label="Thread transcript"
          >
            <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-6 py-7">
              {feed.map((item) => item.kind === "tools" ? (
                <ToolGroup
                  key={`tools:${item.entries[0].id}`}
                  entries={item.entries}
                  working={item.entries[0].id === workingTools}
                />
              ) : (
                <Message
                  key={String(item.entry.id)}
                  align={item.entry.kind === "user" ? "end" : "start"}
                >
                  {item.entry.kind === "user" && profile && ((item.entry.member as ThreadMember | undefined)?.id ?? member?.id) === profile.id && <AvatarFrom avatar={profile.image ?? ""} className="size-8 self-end" />}
                  {item.entry.kind !== "user" && <ThreadMessageAvatar provider={runtimeProvider} lead={item.lead} />}
                  <MessageContent>
                    {item.lead && item.entry.kind === "user" && <MessageHeader>{(item.entry.member as ThreadMember | undefined)?.label ?? "You"}</MessageHeader>}
                    {item.lead && item.entry.kind !== "user" && <MessageHeader>{PROVIDERS.find((provider) => provider.id === runtimeProvider)?.label ?? "Codex"}</MessageHeader>}
                    <Bubble variant={item.entry.kind === "user" ? "muted" : "ghost"}>
                      <BubbleContent className={item.entry.kind === "thinking" ? "text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground italic" : "min-w-0 break-words"}>
                        {item.entry.kind === "thinking" ? String(item.entry.text ?? "") : <Markdown text={threadEntryText(item.entry)} onOpenLink={openLink} />}
                      </BubbleContent>
                    </Bubble>
                    {item.entry.kind === "user" && Array.isArray(item.entry.codeReferences) && item.entry.codeReferences.length > 0 && (
                      // Lines sent from a pull request's diff, named the way the diff names them.
                      <AttachmentGroup data-slot="code-references" className="max-w-full justify-end py-0">
                        {(item.entry.codeReferences as ChatCodeReference[]).map((reference) => (
                          <Attachment key={reference.id} size="sm" className="max-w-80">
                            <AttachmentMedia><FileCode2 /></AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle title={reference.path}>{referenceLabel(reference)}</AttachmentTitle>
                              {reference.comment !== item.entry.text && <AttachmentDescription>{reference.comment}</AttachmentDescription>}
                            </AttachmentContent>
                          </Attachment>
                        ))}
                      </AttachmentGroup>
                    )}
                    {shownArtifacts(item.entry.artifacts).map((artifact, index) => {
                      const route = organizationArtifactRoute(artifact);
                      return <Button key={index} data-link variant="outline" className="h-auto justify-start whitespace-normal text-left" disabled={!route} onClick={() => route && navigate(route)}>
                        {artifact.title}
                      </Button>;
                    })}
                    {(Array.isArray(item.entry.attachments)
                      ? item.entry.attachments
                      : []
                    ).map(
                      (attachment: {
                        id: string;
                        remoteId?: string;
                        name: string;
                      }) =>
                        attachment.remoteId ? (
                          <img
                            key={attachment.id}
                            onLoad={() => {
                              const node = transcript.current;
                              if (followsLatest.current && node && node.clientHeight > 0)
                                node.scrollTop = node.scrollHeight;
                            }}
                            className="h-auto max-h-64 w-auto max-w-full self-end object-contain"
                            alt={attachment.name}
                            src={`${path}/attachments/${attachment.remoteId}`}
                          />
                        ) : null,
                    )}
                  </MessageContent>
                </Message>
              ))}
              {pending && <Message align="start"><MessageContent>
                {pending.phase === "failed" ? <><p role="alert" className="text-sm text-destructive">{pending.error}</p><Button variant="outline" onClick={() => void retryHubThread(pending)}>Retry</Button></>
                  : <ThreadStartMarker progress={pending.progress} />}
              </MessageContent></Message>}
            </div>
          </div>
          {approval && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-4">
              <div className="min-w-0 basis-full overflow-auto max-h-64">
                <ApprovalDetails title={approval.title ?? approval.tool} reason={approval.reason} command={approval.arg} plan={approval.plan} />
              </div>
              <Button
                disabled={disabled}
                onClick={() =>
                  void act("approval", {
                    requestId: approval.requestId,
                    decision: "allow",
                  })
                }
              >
                Allow once
              </Button>
              {approval.allowAlways && (
                <Button
                  disabled={disabled}
                  variant="outline"
                  onClick={() =>
                    void act("approval", {
                      requestId: approval.requestId,
                      decision: "allowAlways",
                    })
                  }
                >
                  Always allow
                </Button>
              )}
              <Button
                disabled={disabled}
                variant="outline"
                onClick={() =>
                  void act("approval", {
                    requestId: approval.requestId,
                    decision: "deny",
                  })
                }
              >
                Decline
              </Button>
            </div>
          )}
          {question && (
            <form
              className="flex shrink-0 flex-col gap-3 border-t p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void act("question", {
                  requestId: question.requestId,
                  answers,
                });
              }}
            >
              {question.questions.map((item, index) => (
                <Field key={index}>
                  <FieldLabel htmlFor={`hub-answer-${index}`}>
                    {item.question}
                  </FieldLabel>
                  {item.options?.length ? (
                    <p className="text-xs text-muted-foreground">
                      {item.options.map((option) => option.label).join(" · ")}
                    </p>
                  ) : null}
                  <Input
                    id={`hub-answer-${index}`}
                    disabled={disabled}
                    required
                    value={answers[item.question] ?? ""}
                    onChange={(e) =>
                      setAnswers({
                        ...answers,
                        [item.question]: e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
              <Button disabled={disabled} type="submit">
                Send answer
              </Button>
            </form>
          )}
          <LinearThreadNotice
            notice={liveNotice !== undefined ? liveNotice ?? undefined : typeof thread.detail.linearNotice === "string" ? thread.detail.linearNotice : undefined}
            organizationId={organizationId}
          />
          <div className={replyComposerFrame}>
            <form className={replyComposerForm} onSubmit={event => { event.preventDefault(); void send(); }}>
              <ReplyComposer
                working={!pending && thread.detail.state === "working"}
                disabled={disabled}
                onStop={() => void act("interrupt")}
                canSend={!disabled && !draft.uploading && !!draft.text.trim()}
                controls={<>
                  {cursorCloud ? <InputGroupText>Cursor Cloud default</InputGroupText> : <ModelPickerButton variant="composer" catalogue={providers} onlyProvider={modelProvider} value={picker.value} disabled={disabled}
                    onPick={choice => void act("options", picker.options(choice))} />}
                  <PermissionPicker value={permission.value} cloud={cursorCloud} disabled={disabled} onChange={permissionMode => void act("options", {permissionMode})} />
                </>}
                context={<>
                  <InputGroupText className="hidden @3xl:flex"><ComputerIcon />{computerName}</InputGroupText>
                  {branch && <BranchName branch={branch} />}
                  <ContextMeter context={thread.detail.context as ContextUsage | undefined} />
                </>}
              >
                <InlineImageComposer key={`${actingComputer ?? "pending"}:${actingThread}`} ref={editor} ariaLabel="Message" placeholder="Reply, or ask for the next change." disabled={disabled}
                  onChange={setDraft} onSubmit={() => void send()} onError={setError}
                  onUpload={async file => {
                    const response = await fetch(`${path}/attachments`, {method:"POST",headers:{"content-type":file.type,"x-filename":file.name},body:file});
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error ?? "This image could not be attached.");
                    return {id:result.id,name:file.name,mimeType:file.type as "image/png" | "image/jpeg" | "image/gif" | "image/webp",sizeBytes:file.size};
                  }}
                />
              </ReplyComposer>
            </form>
          </div>
        </>
          )}
        </HubThreadWorkbench>
      ) : (
        <>
          {showNavigation && <PaneHeader sidebar crumbs={[{ label: "Threads" }]}>
            <HubNotifications organizationId={organizationId} />
          </PaneHeader>}
          {error && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>
          )}
          {!loaded && threadId && !pending ? (
            <div className="p-4"><PaneLoading label="Loading threads" /></div>
          ) : threadId ? (
            <EmptyState title="This thread is unavailable" description="Ask the person who started it to check your access." />
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto">
              {!loaded && <span role="status" aria-label="Loading threads" className="sr-only">Loading threads</span>}
              <HubThreadComposer key={organizationId} organizationId={organizationId} memberId={member?.id} computers={computers} computersLoaded={computersLoaded} computerError={computerError} canManageWorkspaces={canManageWorkspaces} open={open} sharingControl={newThreadSharingControl} controlledVisibility={newThreadVisibility} controlledMessage={newThreadMessage} onMessageChange={onNewThreadMessageChange} workspaceOptions={newThreadWorkspaceOptions} controlledWorkspaceId={newThreadWorkspaceId} onWorkspaceChange={onNewThreadWorkspaceChange} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/// Heartbeats carry no words. A run of real tool calls is one line in the thread.
function transcriptItems(entries: ConvEntry[]) {
  const readable = entries.filter((entry) => (
    entry.kind !== "tool" || Boolean(entry.verb || entry.tool || entry.arg || entry.output || entry.text || entry.diff?.length)
  ));
  const items: ({ kind: "tools"; entries: ConvEntry[] } | { kind: "entry"; entry: ConvEntry; lead: boolean })[] = [];
  readable.forEach((entry, index) => {
    if (entry.kind === "tool") {
      const previous = items.at(-1);
      if (previous?.kind === "tools") previous.entries.push(entry);
      else items.push({ kind: "tools", entries: [entry] });
      return;
    }
    items.push({
      kind: "entry",
      entry,
      lead: index === 0 || speaker(readable[index - 1]) !== speaker(entry),
    });
  });
  return items;
}
