import { watchHubComputers } from "@/lib/hub-computers";
import { HubNotifications } from "./HubNotifications";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useEffect, useRef, useState } from "react";
import {
  canWriteThread,
  type HubThread,
  type ThreadMember,
  type ComputerSummary,
} from "@remy/contract";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
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
}: {
  organizationId: string;
  computerId?: string;
  threadId?: string;
  navigate: (route: Route) => void;
}) {
  const transcript = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [member, setMember] = useState<ThreadMember>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  useEffect(() => {
    setThreads([]);
    setLoaded(false);
    setError("");
    const offComputers = watchHubComputers(organizationId, setComputers, setError);
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
    setMessage("");
    setAnswers({});
    setAttachments([]);
  }, [threadId, computerId]);
  const thread = threads.find(
    (item) => item.id === threadId && item.computerId === computerId,
  );
  useEffect(() => {
    if (followsLatest.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [thread?.revision]);
  useEffect(() => {
    followsLatest.current = true;
  }, [threadId, computerId]);
  const computer = computers.find((c) => c.computerId === thread?.computerId);
  const ComputerIcon = deviceIcon(computer?.icon as DeviceIconId);
  const writable =
    !!thread && !!member && canWriteThread(thread.access, member.id);
  const disabled = busy || !thread || thread.stale || !writable;
  const path = hubThreadPath(organizationId, computerId ?? "", threadId);
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
    if (disabled || !message.trim()) return;
    const accepted = await act("message", {
      text: message,
      messageId: `u-${crypto.randomUUID()}`,
      attachmentIds: attachments,
    });
    if (accepted) {
      setMessage("");
      setAttachments([]);
    }
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Team threads"
    >
      <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b p-4">
        <HubNotifications organizationId={organizationId} />
        <Button
          variant="ghost"
          data-link
          onClick={() => navigate({ name: "threads", organizationId })}
        >
          Team threads
        </Button>
        {thread && (
          <div className="min-w-0 flex-1">
            <p className="break-words">{thread.detail.title}</p>
            <p className="text-xs text-muted-foreground">
              {thread.access.visibility === "private"
                ? "Private"
                : "Open to your organization"}
            </p>
          </div>
        )}
      </header>
      {thread && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground"><Button variant="link" size="sm" data-link onClick={() => navigate({ name: "settings", tab: "devices", organizationId })}><ComputerIcon />{computer?.name ?? "Computer unavailable"}</Button><span className="min-w-0 break-words">Started by {thread.access.owner.label}</span></div>}
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Wait while your threads load.
        </p>
      ) : threadId && !thread ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This thread is unavailable</EmptyTitle>
            <EmptyDescription>
              Ask the person who started it to check your access.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !thread ? (
        <div className="flex min-w-0 flex-col gap-3 overflow-auto p-4">
          {threads.map((item) => (
            <Button
              key={`${item.computerId}:${item.id}`}
              variant="ghost"
              className="h-auto justify-start whitespace-normal text-left"
              data-link
              onClick={() => open(item.computerId, item.id)}
            >
              <span className="min-w-0 break-words">{item.detail.title}<span className="block text-xs text-muted-foreground">{computers.find((c) => c.computerId === item.computerId)?.name ?? "Computer unavailable"} · Started by {item.access.owner.label}{item.stale ? " · Offline" : ""}</span></span>
            </Button>
          ))}
          {!threads.length && (
            <p className="text-sm text-muted-foreground">
              Choose a workspace to start a thread.
            </p>
          )}
          {computers
            .filter(
              (computer) =>
                computer.canUse !== false && computer.availability !== "offline" && !computer.updateRequired,
            )
            .flatMap((computer) =>
              computer.capabilities.workspaces.map((workspace) => (
                <Button
                  key={`${computer.computerId}:${workspace.id}`}
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const result = await hubRequest<{ id: string }>(
                        hubThreadPath(organizationId, computer.computerId),
                        "POST",
                        { workspaceId: workspace.id },
                      );
                      open(computer.computerId, result.id);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "This thread could not start.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Start in {workspace.name} · {computer.name}
                </Button>
              )),
            )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <span>
              {thread.access.participants
                .map((person) => person.label)
                .join(", ")}
            </span>
            {thread.stale && (
              <span role="status">
                This computer is offline; you’re reading its last saved update.
              </span>
            )}
            {!writable && (
              <Button
                size="sm"
                disabled={busy || thread.stale}
                onClick={() => void act("join")}
              >
                Join thread
              </Button>
            )}
            {member?.id === thread.access.owner.id && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || thread.stale}
                onClick={() =>
                  void act("visibility", {
                    visibility:
                      thread.access.visibility === "private"
                        ? "open"
                        : "private",
                  })
                }
              >
                {thread.access.visibility === "private"
                  ? "Open to organization"
                  : "Make private"}
              </Button>
            )}
          </div>
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
              {thread.detail.entries.map((entry) => (
                <Message
                  key={String(entry.id)}
                  align={entry.kind === "user" ? "end" : "start"}
                >
                  <MessageContent>
                    <MessageHeader>
                      {(entry.member as ThreadMember | undefined)?.label ??
                        (entry.kind === "user"
                          ? "You"
                          : entry.kind === "tool"
                            ? String(entry.tool ?? "Tool")
                            : "Agent")}
                    </MessageHeader>
                    <Bubble
                      variant={entry.kind === "user" ? "default" : "ghost"}
                    >
                      <BubbleContent className="whitespace-pre-wrap break-words">
                        {String(entry.text ?? entry.output ?? entry.arg ?? "")}
                      </BubbleContent>
                    </Bubble>
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
          <form
            className="shrink-0 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <InputGroup>
              <InputGroupTextarea
                aria-label="Message"
                placeholder="Write a message…"
                value={message}
                disabled={disabled}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <InputGroupAddon align="block-end" className="flex-wrap">
                <InputGroupButton
                  className="h-auto max-w-full whitespace-normal"
                  disabled={disabled || !message.trim()}
                  type="submit"
                >
                  Send message
                </InputGroupButton>
                <InputGroupButton
                  className="h-auto max-w-full whitespace-normal"
                  disabled={disabled || thread.detail.state === "idle"}
                  onClick={() => void act("interrupt")}
                >
                  Stop turn
                </InputGroupButton>
                <label className="min-w-0 max-w-full text-xs">
                  Attach image
                  <input
                    aria-label="Attach image"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={disabled || attachments.length >= 8}
                    className="block w-40 max-w-full text-xs"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      try {
                        const response = await fetch(`${path}/attachments`, {
                          method: "POST",
                          headers: {
                            "content-type": file.type,
                            "x-filename": file.name,
                          },
                          body: file,
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error);
                        setAttachments((old) => [...old, result.id]);
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : "This image could not be attached.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                {attachments.length > 0 && (
                  <span className="text-xs">{attachments.length} attached</span>
                )}
              </InputGroupAddon>
            </InputGroup>
          </form>
        </>
      )}
    </section>
  );
}
