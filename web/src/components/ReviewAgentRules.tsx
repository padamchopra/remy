import { useState, type ReactNode } from "react";
import { ChevronLeft, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { REVIEW_RULE_TEXT_MAX } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog-base";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu-base";
import { ScrollArea } from "@/components/ui/scroll-area";
import { segmentedSegment, segmentedTrack } from "@/components/ui/segmented-base";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch-base";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs-base";
import { apiError } from "@/lib/api-error";
import { createReviewRule, deleteReviewRule, ruleSourceLine, updateReviewRule, type ReviewRule } from "@/lib/review-agent";
import { cn } from "@/lib/utils";

type Scope = "repository" | "all";

const OUTLINE = "h-7 rounded-lg border-input bg-transparent px-3 text-xs font-normal text-foreground/70 shadow-none hover:text-foreground dark:bg-transparent";
const PRIMARY = "h-7 rounded-lg px-3 text-xs font-semibold";

/// Writing a rule, new or changed: the words and Cancel or Save.
function RuleEditor({ initial = "", label, onCancel, onSave }: {
  initial?: string;
  label: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try { await onSave(text.trim()); } catch { /* the toast said why; the words stay */ } finally { setSaving(false); }
  };
  return (
    <div className="flex flex-col gap-2 px-2 py-2.5">
      <textarea
        aria-label={label}
        autoFocus
        value={text}
        maxLength={REVIEW_RULE_TEXT_MAX}
        disabled={saving}
        placeholder="One sentence you want on every review"
        onChange={(change) => setText(change.target.value)}
        onKeyDown={(key) => {
          if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); onCancel(); }
          else if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) { key.preventDefault(); void save(); }
        }}
        className="field-sizing-content min-h-[38px] w-full resize-none rounded-lg border border-border bg-sidebar/50 px-2.5 py-2 text-[13px] leading-[19px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} className={OUTLINE} onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={saving || !text.trim()} className={PRIMARY} onClick={() => void save()}>
          {saving && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function RuleRow({ rule, repository, name, onChanged, onRemoved }: {
  rule: ReviewRule;
  repository: string;
  name: string;
  onChanged: (rule: ReviewRule) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = async (patch: Parameters<typeof updateReviewRule>[1], failure: string) => {
    setBusy(true);
    try {
      onChanged(await updateReviewRule(rule.id, patch));
    } catch (caught) {
      toast.error(failure, { description: apiError(caught) });
      throw caught;
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteReviewRule(rule.id);
      setConfirming(false);
      onRemoved(rule.id);
    } catch (caught) {
      toast.error("Couldn't delete the rule", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <li>
        <RuleEditor
          initial={rule.text}
          label="Edit rule"
          onCancel={() => setEditing(false)}
          onSave={async (text) => { await change({ text }, "Couldn't save the rule"); setEditing(false); }}
        />
      </li>
    );
  }
  return (
    <li data-slot="review-rule" className="group/rule flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-accent has-[:focus-visible]:bg-accent">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <p className={cn("text-[13px] leading-[19px] break-words", rule.enabled ? "text-foreground" : "text-muted-foreground")}>{rule.text}</p>
        <p className="text-[11px] leading-4 text-muted-foreground">{ruleSourceLine(rule)}</p>
      </div>
      <Menu>
        <MenuTrigger
          render={(
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Rule actions: ${rule.text}`}
              className="size-5 rounded-md text-foreground/70 group-hover/rule:!opacity-100 group-focus-within/rule:!opacity-100 data-[popup-open]:!opacity-100 [@media(hover:hover)]:opacity-0"
            />
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </MenuTrigger>
        <MenuContent align="end" className="w-52">
          <MenuItem onClick={() => setEditing(true)}>Edit</MenuItem>
          <MenuItem onClick={() => void change({ repository: rule.repository ? null : repository }, "Couldn't move the rule").catch(() => undefined)}>
            {rule.repository ? "Move to all workspaces" : `Move to ${name}`}
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-destructive data-highlighted:text-destructive" onClick={() => setConfirming(true)}>Delete</MenuItem>
        </MenuContent>
      </Menu>
      <Switch
        checked={rule.enabled}
        disabled={busy}
        aria-label={rule.enabled ? `Turn off: ${rule.text}` : `Turn on: ${rule.text}`}
        onCheckedChange={(enabled) => void change({ enabled }, enabled ? "Couldn't turn the rule on" : "Couldn't turn the rule off").catch(() => undefined)}
        className="mt-px"
      />
      <Dialog open={confirming} onOpenChange={(open) => { if (!busy) setConfirming(open); }}>
        <DialogContent showCloseButton={false} className="gap-4 rounded-2xl bg-popover p-5 sm:max-w-[400px]">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-sm font-semibold">Delete this rule?</DialogTitle>
            <DialogDescription className="text-xs">Your review agent stops following it from its next turn.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2.5">
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} className={OUTLINE} />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={busy} className={PRIMARY} onClick={() => void remove()}>
              {busy && <Spinner data-icon="inline-start" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/// Your review rules for this repository and for all your workspaces: where
/// each came from, a switch to turn it off, and a menu to change or delete
/// it. Add rule writes one into the list in front.
export function ReviewAgentRules({ repository, workspace, rules, onBack, onChanged }: {
  repository: string;
  workspace: { name: string; smallMark?: ReactNode };
  rules?: ReviewRule[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [scope, setScope] = useState<Scope>("repository");
  const [adding, setAdding] = useState(false);
  const [local, setLocal] = useState<{ source?: ReviewRule[]; rules: ReviewRule[] }>();
  // Edits show at once; the next read from the hub replaces them.
  const current = local && local.source === rules ? local.rules : rules;
  const patch = (next: (list: ReviewRule[]) => ReviewRule[]) => {
    setLocal({ source: rules, rules: next(current ?? []) });
    onChanged();
  };
  const own = (current ?? []).filter((rule) => rule.repository?.toLowerCase() === repository.toLowerCase());
  const all = (current ?? []).filter((rule) => rule.repository === null);
  const shown = scope === "repository" ? own : all;
  const add = async (text: string) => {
    try {
      const rule = await createReviewRule(text, scope === "repository" ? repository : null);
      patch((list) => [rule, ...list]);
      setAdding(false);
    } catch (caught) {
      toast.error("Couldn't add the rule", { description: apiError(caught) });
      throw caught;
    }
  };
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border pr-3 pl-2.5">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to the review agent" className="size-7 rounded-lg text-foreground/70" onClick={onBack}>
          <ChevronLeft className="size-[15px]" />
        </Button>
        <h2 className="text-sm leading-5 font-semibold tracking-[-0.01em] text-foreground">Rules</h2>
        <span className="min-w-0 flex-1" />
        <Button type="button" variant="outline" disabled={adding} onClick={() => setAdding(true)} className="h-7 gap-1.5 rounded-lg border-input bg-transparent px-2.5 text-xs font-normal shadow-none dark:bg-transparent">
          <Plus aria-hidden className="size-3 text-foreground/70" />
          Add rule
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportProps={{ "aria-label": "Rules" }}>
        <div className="flex flex-col gap-3 px-4 pt-4 pb-2">
          <p className="text-xs leading-[18px] text-foreground/70">Your review agent follows these on every review. It suggests new ones when you correct it.</p>
          <Tabs value={scope} onValueChange={(value) => { setScope(value as Scope); setAdding(false); }} className="gap-0">
            <TabsList aria-label="Where rules apply" className={segmentedTrack}>
              <TabsTrigger value="repository" className={cn(segmentedSegment, "data-active:bg-foreground/10 data-active:text-foreground")}>
                {workspace.smallMark}
                {workspace.name}
                <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{own.length}</span>
              </TabsTrigger>
              <TabsTrigger value="all" className={cn(segmentedSegment, "data-active:bg-foreground/10 data-active:text-foreground")}>
                All workspaces
                <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{all.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ul aria-label={scope === "repository" ? `Rules for ${workspace.name}` : "Rules for all workspaces"} className="flex flex-col px-2 py-1">
          {adding && (
            <li>
              <RuleEditor label="New rule" onCancel={() => setAdding(false)} onSave={add} />
            </li>
          )}
          {!current ? (
            <li className="flex justify-center py-6"><Spinner className="text-muted-foreground" /></li>
          ) : shown.length === 0 && !adding ? (
            <li className="px-2 py-2.5 text-xs leading-[18px] text-muted-foreground">
              {scope === "repository" ? `No rules for ${workspace.name} yet.` : "No rules for all your workspaces yet."} Correct the agent and it suggests one, or use Add rule.
            </li>
          ) : shown.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              repository={repository}
              name={workspace.name}
              onChanged={(next) => patch((list) => list.map((entry) => (entry.id === next.id ? next : entry)))}
              onRemoved={(id) => patch((list) => list.filter((entry) => entry.id !== id))}
            />
          ))}
        </ul>
        <p className="px-4 py-2 pb-4 text-[11px] leading-4 text-muted-foreground">Only you see these rules. They apply on any computer you review from.</p>
      </ScrollArea>
    </>
  );
}
