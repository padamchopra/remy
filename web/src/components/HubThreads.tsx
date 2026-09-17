import { speaker } from "@/lib/thread-message";
import { useHubThreadBranch } from "@/lib/hub-thread-branch";
import { ThreadMessageAvatar } from "./ThreadMessageAvatar";
import { BranchName } from "./BranchName";
import { ContextMeter } from "./ContextMeter";
import type { ContextUsage } from "@/state/types";
import { ReplyComposer, replyComposerFrame, replyComposerForm } from "./ReplyComposer";
import { InlineImageComposer, type InlineImageComposerHandle, type InlineImageComposerValue } from "./InlineImageComposer";
import { InputGroupText } from "./ui/input-group";
import { ModelPickerButton } from "./ModelPicker";
import { ComposerMenu } from "./ComposerMenu";
import { PERMISSIONS, permissionOf } from "@/lib/chat-options";
import { hostedModels } from "@/lib/hub-models";
import { useHubResource } from "@/lib/hub-organization";
import type { ModelAccessEntry } from "./HubModelAccess";
import { AvatarFrom } from "./UserAvatar";
import { useHubProfile } from "@/lib/hub-profile";
import { useThreadStarts, retryHubThread, forgetThreadStart } from "@/lib/hub-thread-start";
import { LoaderCircle, MessagesSquare, MoreHorizontal } from "lucide-react";
import { TabStrip, WorkbenchTabTrigger, tabListClass } from "@/components/WorkbenchTabs";
import { Tabs, TabsList } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { EmptyState } from "@/components/EmptyState";
import { PaneLoading } from "@/components/PaneLoading";
import { PaneHeader } from "@/components/PaneHeader";
import { usePersonalHub } from "@/lib/hub-scope";
import { organizationArtifactRoute } from "@/lib/artifact-route";
import type { ConvArtifact } from "@/state/types";
import { HubThreadComposer, type HubThreadWorkspaceOption } from "./HubThreadComposer";
import { watchHubComputers } from "@/lib/hub-computers";
import { HubNotifications } from "./HubNotifications";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canWriteThread,
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
  hubThreadPath,
  watchHubThreads,
} from "@/lib/hub-threads";
import type { Route } from "@/lib/route";

type Approval = {
  requestId: string;
  title?: string;
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
  computerId,
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
  computerId?: string;
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
  const modelAccess = useHubResource<{providers:ModelAccessEntry[]}>(organizationId,"/model-access");
  const { profile } = useHubProfile(organizationId);
  const transcript = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const isPersonal = usePersonalHub();
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [member, setMember] = useState<ThreadMember>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<InlineImageComposerValue>({text:"",attachments:[],uploading:false});
  const editor = useRef<InlineImageComposerHandle>(null);
  const [busy, setBusy] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [computersLoaded, setComputersLoaded] = useState(false);
  const [computerError, setComputerError] = useState("");
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  useEffect(() => {
    setThreads([]);
    setLoaded(false);
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

  }, [threadId, computerId]);
  const starts = useThreadStarts();
  const pending = starts.find(s => !!threadId && s.ownerId === member?.id && s.organizationId === organizationId && ((computerId === "pending" && s.requestId === threadId) || (s.created?.id === threadId && s.created?.computerId === computerId)));
  const savedThread = threads.find(
    (item) => item.computerId !== "pending" && item.id === threadId && item.computerId === computerId,
  );
  const thread: HubThread | undefined = savedThread ?? (pending ? {
    id: pending.requestId, computerId: pending.created?.computerId ?? "pending", stale: false, revision: 0, observedAt: pending.at,
    access: {organizationId, owner: member ?? {id: "pending", label: "You"}, participants: [], visibility: pending.visibility},
    detail: {id: pending.requestId, title: pending.message.slice(0, 200), state: "working", entries: [{id: `u-${pending.requestId}`, kind: "user", text: pending.message}]},
  } : undefined);
  useEffect(() => {
    if (pending?.phase === "ready" && pending.created && computerId === "pending") {
      navigate({name: "threads", organizationId, computerId: pending.created.computerId, threadId: pending.created.id});
    }
    if (pending && savedThread) forgetThreadStart(pending.requestId);
  }, [pending, savedThread, computerId, organizationId, navigate]);
  useEffect(() => {
    if (followsLatest.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [thread?.revision]);
  useEffect(() => {
    followsLatest.current = true;
  }, [threadId, computerId]);
  const computer = computers.find((c) => c.computerId === thread?.computerId);
  const branch = useHubThreadBranch(organizationId, savedThread, computer) ?? pending?.branch;
  const ComputerIcon = deviceIcon((computer?.icon ?? (pending?.computerId?.startsWith("cloud:") ? "cloud" : undefined)) as DeviceIconId);
  const writable =
    !!thread && !!member && canWriteThread(thread.access, member.id);
  const disabled = !!pending || busy || !thread || thread.stale || !writable;
  const path = hubThreadPath(organizationId, computerId ?? "", threadId);
  const runtimeProvider = String(thread?.detail.provider ?? pending?.provider ?? "codex");
  const runtimeModel = String(thread?.detail.model ?? pending?.model ?? "");
  const gateway = /^remy:(openrouter|router|openai):(.+)$/.exec(runtimeModel);
  const modelProvider = gateway?.[1] ?? (runtimeProvider === "claude" ? "anthropic" : runtimeProvider);
  const providers = hostedModels(modelAccess.value?.providers ?? [], true, {provider: modelProvider, model: gateway?.[2] ?? runtimeModel});
  const permission = permissionOf(typeof thread?.detail.permissionMode === "string" ? thread.detail.permissionMode : undefined);
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
  const open = (computer: string, id?: string) =>
    navigate({
      name: "threads",
      organizationId,
      computerId: computer,
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
        <Tabs value={thread.id} className="shrink-0 gap-0">
          <TabStrip actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Thread details"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>{thread.access.visibility === "private" ? "Private" : isPersonal ? "Only you" : "Shared with your organization"}</DropdownMenuLabel>
                <DropdownMenuLabel className="font-normal text-muted-foreground">Started by {thread.access.owner.label}</DropdownMenuLabel>
                {!isPersonal && thread.access.participants.length > 0 && <DropdownMenuLabel className="font-normal text-muted-foreground">{thread.access.participants.map(person => person.label).join(", ")}</DropdownMenuLabel>}
                <DropdownMenuItem onSelect={() => navigate({ name: "settings", tab: "devices", organizationId })}>
                  <ComputerIcon />{computer?.name ?? pending?.computerName ?? "Computer unavailable"}
                </DropdownMenuItem>
                {!pending && !isPersonal && member?.id === thread.access.owner.id && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={busy || thread.stale} onSelect={() => void act("visibility", { visibility: thread.access.visibility === "private" ? "open" : "private" })}>
                    {thread.access.visibility === "private" ? "Share with organization" : "Make private"}
                  </DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          }>
            {!showNavigation && <SidebarTrigger className="md:hidden" />}
            <TabsList aria-label="Open tabs" className={tabListClass}>
              <WorkbenchTabTrigger value={thread.id} label={thread.detail.title} title={thread.detail.title} icon={<MessagesSquare className="size-3.5 shrink-0" />} />
            </TabsList>
          </TabStrip>
        </Tabs>
      ) : showNavigation && <PaneHeader sidebar crumbs={[{ label: "Threads" }]}>
        <HubNotifications organizationId={organizationId} />
      </PaneHeader>}
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!loaded && threadId && !pending ? (
        <div className="p-4"><PaneLoading label="Loading threads" /></div>
      ) : threadId && !thread ? (
        <EmptyState title="This thread is unavailable" description="Ask the person who started it to check your access." />
      ) : !thread ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto">
          {!loaded && <span role="status" aria-label="Loading threads" className="sr-only">Loading threads</span>}
          <HubThreadComposer key={organizationId} organizationId={organizationId} memberId={member?.id} computers={computers} computersLoaded={computersLoaded} computerError={computerError} canManageWorkspaces={canManageWorkspaces} open={open} sharingControl={newThreadSharingControl} controlledVisibility={newThreadVisibility} controlledMessage={newThreadMessage} onMessageChange={onNewThreadMessageChange} workspaceOptions={newThreadWorkspaceOptions} controlledWorkspaceId={newThreadWorkspaceId} onWorkspaceChange={onNewThreadWorkspaceChange} />
        </div>
      ) : (
        <>
          {!pending && !writable && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
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
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
              {thread.detail.entries.map((entry, index) => (
                <Message
                  key={String(entry.id)}
                  align={entry.kind === "user" ? "end" : "start"}
                >
                  {entry.kind === "user" && profile && ((entry.member as ThreadMember | undefined)?.id ?? member?.id) === profile.id && <AvatarFrom avatar={profile.image ?? ""} className="size-8 self-end" />}
                  {(entry.kind === "assistant" || entry.kind === "thinking") && <ThreadMessageAvatar provider={runtimeProvider} lead={index === 0 || speaker(thread.detail.entries[index - 1]) !== speaker(entry)} /> }
                  <MessageContent>
                    {entry.kind !== "assistant" && entry.kind !== "thinking" && <MessageHeader>
                      {(entry.member as ThreadMember | undefined)?.label ??
                        (entry.kind === "user"
                          ? "You"
                          : entry.kind === "tool"
                            ? String(entry.tool ?? "Tool")
                            : "Agent")}
                    </MessageHeader>}
                    <Bubble
                      variant={entry.kind === "user" ? "default" : "ghost"}
                    >
                      <BubbleContent className="whitespace-pre-wrap break-words">
                        {String(entry.text ?? entry.output ?? entry.arg ?? "")}
                      </BubbleContent>
                    </Bubble>
                    {(Array.isArray(entry.artifacts) ? entry.artifacts as ConvArtifact[] : []).map((artifact, index) => {
                      const route = organizationArtifactRoute(artifact);
                      return <Button key={index} data-link variant="outline" className="h-auto justify-start whitespace-normal text-left" disabled={!route} onClick={() => route && navigate(route)}>
                        {artifact.title}
                      </Button>;
                    })}
                    {(Array.isArray(entry.attachments)
                      ? entry.attachments
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
                              if (followsLatest.current && transcript.current)
                                transcript.current.scrollTop =
                                  transcript.current.scrollHeight;
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
                  : <LoaderCircle role="status" aria-label="Starting thread" className="size-4 animate-spin text-muted-foreground" />}
              </MessageContent></Message>}
            </div>
          </div>
          {approval && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-4">
              <p className="min-w-0 flex-1 break-words">
                {approval.title ?? `${approval.tool}: ${approval.arg ?? ""}`}
              </p>
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
          <div className={replyComposerFrame}>
            <form className={replyComposerForm} onSubmit={event => { event.preventDefault(); void send(); }}>
              <ReplyComposer
                working={!pending && thread.detail.state === "working"}
                disabled={disabled}
                onStop={() => void act("interrupt")}
                canSend={!disabled && !draft.uploading && !!draft.text.trim()}
                controls={<>
                  <ModelPickerButton variant="composer" catalogue={providers} onlyProvider={modelProvider} value={{provider:modelProvider,model:gateway?.[2] ?? runtimeModel,effort:String(thread.detail.effort ?? "")}} disabled={disabled}
                    onPick={choice => void act("options", {model:gateway ? `remy:${gateway[1]}:${choice.model}` : choice.model,effort:choice.effort ?? null})} />
                  <ComposerMenu icon={permission.icon} label={permission.label} value={permission.value} options={PERMISSIONS} disabled={disabled} onChange={permissionMode => void act("options", {permissionMode})} />
                </>}
                context={<>
                  <InputGroupText className="hidden @3xl:flex"><ComputerIcon />{computer?.name ?? pending?.computerName ?? "Computer unavailable"}</InputGroupText>
                  {branch && <BranchName branch={branch} />}
                  <ContextMeter context={thread.detail.context as ContextUsage | undefined} />
                </>}
              >
                <InlineImageComposer key={`${computerId}:${threadId}`} ref={editor} ariaLabel="Message" placeholder="Reply, or ask for the next change." disabled={disabled}
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
    </section>
  );
}
