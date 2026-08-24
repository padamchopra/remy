import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentIconPicker } from "@/components/AgentIconPicker";
import { AgentMark } from "@/components/AgentAvatar";
import { EditableName } from "@/components/EditableName";
import { ModelPickerButton, REMY_DEFAULT } from "@/components/ModelPicker";
import { apiError } from "@/lib/api-error";
import { TINT_IDS, tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Agent } from "@/state/types";

/// Everything about one agent, opened from its conversation in the inbox.
///
/// The roster lives in the inbox rather than in Settings: an agent is somebody
/// you talk to, and what it is called and how it thinks belongs next to the
/// conversation rather than three panes away.
///
/// Everything saves as you go. Menus and switches save on change; text saves
/// when you leave the field, because saving a paragraph on every keystroke is a
/// write per character.

/// Two, because an agent that stops for permission on every edit is an agent
/// you have to sit with, which is not what one is for.
const PERMISSIONS = [
  { value: "auto", label: "Auto", detail: "Reads and writes on its own. Stops for anything it cannot undo." },
  { value: "bypassPermissions", label: "Bypass", detail: "Never stops to ask, including for commands that destroy work." },
];

/// Who an agent's commits credit. Shared with Settings, where the machine's
/// own default for this is set.
export const IDENTITIES = [
  { value: "off", label: "You", detail: "Commits carry your name." },
  { value: "author", label: "Agent", detail: "The agent is the author; you remain the committer." },
];

const AGENT_IDENTITIES = [
  { value: REMY_DEFAULT, label: "Remy default", detail: "Follows the choice in General." },
  ...IDENTITIES,
];

export function AgentSettings({
  agent,
  defaultGitIdentity,
  defaultProvider,
  defaultModel,
  defaultEffort,
  onDeleted,
}: {
  agent: Agent;
  defaultGitIdentity: string;
  defaultProvider: string;
  defaultModel: string;
  defaultEffort: string;
  onDeleted: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const saveAgent = useStore((s) => s.saveAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);

  // Text fields are held here while they are being typed and written when the
  // field is left, so a paragraph is one save rather than one per character.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const text = (key: keyof Agent) => draft[key] ?? ((agent[key] as string | undefined) ?? "");

  const save = async (patch: Record<string, unknown>, what: string) => {
    try {
      await saveAgent(agent.id, patch);
    } catch (error) {
      toast.error(`Couldn't change ${what}`, { description: apiError(error) });
      // Put the field back to what the server still believes.
      setDraft((current) => {
        const next = { ...current };
        for (const key of Object.keys(patch)) delete next[key];
        return next;
      });
    }
  };

  /// Writes only when the field actually changed, so tabbing through the pane
  /// is not a dozen writes.
  const commit = (key: keyof Agent, what: string) => () => {
    const value = draft[key as string];
    if (value === undefined || value === (agent[key] ?? "")) return;
    void save({ [key]: value }, what);
  };

  const identity = agent.gitIdentity;
  const resolvedIdentity = identity === REMY_DEFAULT ? defaultGitIdentity : identity;
  // Remy answers for the app itself, so who it is comes with the version you
  // are running. What is left is what a preference actually is: what it thinks
  // with and what it may do unasked.
  const locked = agent.builtIn === true;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <AgentMark agent={agent} className="size-10 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {locked ? (
            <span className="text-lg leading-tight font-semibold">{agent.name}</span>
          ) : (
            <EditableName
              value={agent.name}
              label="agent name"
              className="text-lg leading-tight font-semibold"
              onCommit={(name) => void save({ name }, "the name")}
            />
          )}
          <span className="font-mono text-xs text-muted-foreground">@{agent.handle}</span>
          {locked && (
            <p className="mt-1 text-xs text-muted-foreground">
              Remy comes with the app. Pick what it thinks with; the rest is ours.
            </p>
          )}
        </div>
        {!locked && (
        <AlertDialog>
          {/* Both triggers are `asChild`, so they have to collapse onto the one
              button — a Tooltip root in between would swallow the dialog's
              props and the button would open nothing. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${agent.name}`}>
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete agent</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Threads it already started keep running. Tickets assigned to it lose their assignee.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void deleteAgent(agent.id)
                    .then(onDeleted)
                    .catch((error) => toast.error("Couldn't delete that agent", { description: apiError(error) }))
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        )}
      </header>

      {!locked && (
      <Field>
        <FieldLabel htmlFor="agent-role">Role</FieldLabel>
        <FieldDescription className="text-xs">One line, shown under the name.</FieldDescription>
        <Input
          id="agent-role"
          value={text("role")}
          placeholder="Implements the ticket in its own worktree"
          onChange={(event) => setDraft((c) => ({ ...c, role: event.target.value }))}
          onBlur={commit("role", "the role")}
        />
      </Field>
      )}

      {!locked && (
      <Field>
        <FieldLabel htmlFor="agent-handle">Handle</FieldLabel>
        <FieldDescription className="text-xs">
          What another agent hands a ticket to, and what the CLI will take.
        </FieldDescription>
        <Input
          id="agent-handle"
          className="font-mono"
          value={text("handle")}
          onChange={(event) => setDraft((c) => ({ ...c, handle: event.target.value }))}
          onBlur={commit("handle", "the handle")}
        />
      </Field>
      )}

      {!locked && (
      <Field>
        <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
        <FieldDescription className="text-xs">
          Added to Claude Code's own, not swapped for them.
        </FieldDescription>
        <Textarea
          id="agent-instructions"
          rows={12}
          className="font-normal"
          value={text("instructions")}
          placeholder="How this agent works, in the second person."
          onChange={(event) => setDraft((c) => ({ ...c, instructions: event.target.value }))}
          onBlur={commit("instructions", "the instructions")}
        />
      </Field>
      )}

      {!locked && (
      <>
        <Field>
          <FieldLabel>Icon</FieldLabel>
          <FieldDescription className="text-xs">The face this agent wears everywhere.</FieldDescription>
          <AgentIconPicker agent={agent} onChange={(avatar) => void save({ avatar }, "the icon")} />
        </Field>

        <Field>
          <FieldLabel>Colour</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {TINT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={id}
                aria-pressed={agent.tint === id}
                onClick={() => void save({ tint: id }, "the colour")}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  tintOf(id).swatch,
                  agent.tint === id && "ring-2 ring-primary",
                )}
              />
            ))}
          </div>
        </Field>
      </>
      )}

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="agent-model">Thinks with</FieldLabel>
          <ModelPickerButton
            id="agent-model"
            className="w-full"
            allowDefault
            defaultChoice={{ provider: defaultProvider, model: defaultModel, effort: defaultEffort }}
            value={{ provider: agent.provider || REMY_DEFAULT, model: agent.model ?? "", effort: agent.effort ?? "" }}
            onPick={(next) => void save(
              { provider: next.provider, model: next.model, effort: next.effort ?? "" },
              "what it thinks with",
            )}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="agent-permission">Permission mode</FieldLabel>
          <Select
            value={agent.permissionMode}
            onValueChange={(next) => void save({ permissionMode: next }, "what it may do unasked")}
          >
            <SelectTrigger id="agent-permission" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PERMISSIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <FieldDescription className="-mt-3 text-xs">
        {PERMISSIONS.find((option) => option.value === agent.permissionMode)?.detail}
      </FieldDescription>

      {!locked && (
      <>
      <Separator />

      <Field>
        <FieldLabel htmlFor="agent-identity">Commit attribution</FieldLabel>
        <FieldDescription className="text-xs">
          {AGENT_IDENTITIES.find((option) => option.value === identity)?.detail}
        </FieldDescription>
        <Select
          value={identity}
          onValueChange={(next) => void save({ gitIdentity: next }, "who its commits credit")}
        >
          <SelectTrigger id="agent-identity" size="sm" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {AGENT_IDENTITIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {resolvedIdentity !== "off" && (
        <Field>
          <FieldLabel htmlFor="agent-git-name">Name on commits</FieldLabel>
          <FieldDescription className="text-xs">
            Remy pairs it with <span className="font-mono">{agent.gitEmail}</span>; .invalid is reserved
            and cannot receive mail.
          </FieldDescription>
          <Input
            id="agent-git-name"
            className="sm:w-64"
            value={text("gitName")}
            placeholder={agent.name}
            onChange={(event) => setDraft((c) => ({ ...c, gitName: event.target.value }))}
            onBlur={commit("gitName", "the name on its commits")}
          />
        </Field>
      )}

      <Separator />

      {agents.filter((other) => other.id !== agent.id && !other.builtIn).length > 0 && (
        <Field>
          <FieldLabel>May hand a ticket to</FieldLabel>
          <FieldDescription className="text-xs">
            It can pass work to nobody else unless you pick someone.
          </FieldDescription>
          <div className="flex flex-wrap gap-1.5">
            {agents
              .filter((other) => other.id !== agent.id && !other.builtIn)
              .map((other) => {
                const on = agent.handoffTo.includes(other.handle);
                return (
                  <Button
                    key={other.id}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() =>
                      void save(
                        {
                          handoffTo: on
                            ? agent.handoffTo.filter((handle) => handle !== other.handle)
                            : [...agent.handoffTo, other.handle],
                        },
                        "who it may hand a ticket to",
                      )
                    }
                  >
                    @{other.handle}
                  </Button>
                );
              })}
          </div>
        </Field>
      )}

      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor="agent-autostart">Start unattended</FieldLabel>
          <FieldDescription className="text-xs">
            Lets the board run this agent when a ticket reaches Todo.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="agent-autostart"
          checked={agent.autoStart}
          onCheckedChange={(next) => void save({ autoStart: next }, "whether it starts unattended")}
        />
      </Field>
      </>
      )}
    </div>
  );
}
