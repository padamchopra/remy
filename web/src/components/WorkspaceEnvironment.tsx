import { useState, type ClipboardEvent } from "react";
import { Lock, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { isEnvironmentKey, type WorkspaceEnvironment as Environment, type WorkspaceEnvironmentValue } from "@remy/contract";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { Avatar, AvatarFallback } from "./ui/avatar-base";
import { Segmented, SegmentedItem } from "./ui/segmented-base";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip-base";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog-base";
import { Spinner } from "./ui/spinner";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { parseEnvironmentText } from "@/lib/environment-text";
import { initials } from "@/lib/pull-request-detail";
import { apiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

type Kind = WorkspaceEnvironmentValue["kind"];
type Scope = WorkspaceEnvironmentValue["scope"];
type Draft = { id: string; key: string; value: string; kind: Kind; scope: Scope };

const blank = (): Draft => ({ id: crypto.randomUUID(), key: "", value: "", kind: "variable", scope: "workspace" });
const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/// A workspace's one environment: the values every thread here receives, and
/// your own Personal values, which follow you into every thread you start.
export function WorkspaceEnvironment({ organizationId, workspaceId, workspaceName, organizationName, personal }: {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  organizationName: string;
  personal: boolean;
}) {
  const environment = useHubResource<Environment>(organizationId, `/workspaces/${encodeURIComponent(workspaceId)}/environment`);
  const [adding, setAdding] = useState(false);
  const values = environment.value?.values;
  const path = `${hubThreadBase(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/environment`;
  const remove = async (value: WorkspaceEnvironmentValue) => {
    try {
      await hubRequest(`${path}/${encodeURIComponent(value.id)}`, "DELETE");
      toast.success(`${value.key} is removed.`);
    } catch (cause) {
      toast.error(`Couldn't remove ${value.key}`, { description: apiError(cause) });
    }
  };
  return <section aria-labelledby="workspace-environment" className="flex flex-col gap-2.5">
    <div className="flex items-center justify-between gap-3">
      <h2 id="workspace-environment" className="text-[13px] leading-[18px] font-semibold">Environment</h2>
      {!!values?.length && <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-[7px] px-2 text-xs font-[450] text-muted-foreground has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-[13px]" onClick={() => setAdding(true)}>
        <Plus strokeWidth={1.8} />
        Add values
      </Button>}
    </div>
    {!values ? environment.error
      ? <p role="alert" className="text-xs text-muted-foreground">{environment.error}</p>
      : <div className="h-10 rounded-[10px] border border-border" aria-busy="true" />
      : values.length === 0
        ? <Item variant="outline" className="flex-nowrap gap-3.5 rounded-[10px] border-dashed border-input p-4">
            <ItemMedia className="size-8 rounded-[9px] border border-input bg-muted">
              <Lock className="size-[15px] text-muted-foreground" strokeWidth={1.8} aria-hidden />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle className="text-[13px] leading-[18px] font-medium">No values yet</ItemTitle>
              <ItemDescription className="text-xs leading-4">Add the variables and secrets threads here need.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" size="sm" className="h-7.5 rounded-lg px-2.5 text-xs" onClick={() => setAdding(true)}>Add values</Button>
            </ItemActions>
          </Item>
        : <>
            <ItemGroup className="overflow-hidden rounded-[10px] border border-border">
              {values.map(value => <ValueRow key={value.id} value={value} onRemove={() => void remove(value)} />)}
            </ItemGroup>
            <p className="text-xs leading-4 text-muted-foreground">
              {personal
                ? `Workspace values reach every thread in ${workspaceName}. Personal values reach every thread you start, in any workspace. A Workspace value wins over a Personal one with the same key.`
                : `Workspace values reach every thread in ${workspaceName}, whoever starts it. Personal values are only yours and reach every thread you start. A Workspace value wins over a Personal one with the same key.`}
            </p>
          </>}
    <AddValuesDialog open={adding} onOpenChange={setAdding} path={path} workspaceName={workspaceName} organizationName={organizationName} personal={personal} />
  </section>;
}

function ValueRow({ value, onRemove }: { value: WorkspaceEnvironmentValue; onRemove: () => void }) {
  const secret = value.kind === "secret";
  return <Item role="listitem" className="h-auto min-h-10 flex-nowrap gap-3 rounded-none border-0 border-b border-b-border/70 px-3.5 py-0 last:border-b-0 hover:bg-muted focus-within:bg-muted">
    {/* On a phone the value sits under its key rather than beside it. */}
    <span className="flex min-w-0 flex-1 gap-3 max-sm:flex-col max-sm:gap-0.5 max-sm:py-2">
      <span className="w-[200px] min-w-0 shrink-0 truncate font-mono text-xs leading-4 text-foreground max-sm:w-auto">{value.key}</span>
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs leading-4", secret || value.overridden ? "text-muted-foreground" : "text-foreground", value.overridden && "line-through")}>
        {secret ? <><span aria-hidden>••••••••••••</span><span className="sr-only">Hidden</span></> : value.value}
        {value.overridden && <span className="sr-only"> (the Workspace value with this key wins)</span>}
      </span>
    </span>
    <span className="flex w-[76px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
      {secret && <Lock className="size-[11px]" strokeWidth={1.8} aria-hidden />}
      {secret ? "Secret" : "Variable"}
    </span>
    <span className="flex w-[84px] shrink-0 items-center">
      <span className={cn("inline-flex h-5 items-center rounded-md px-[7px] text-[11px] font-medium", value.scope === "workspace" ? "border border-input text-muted-foreground" : "bg-input text-foreground")}>
        {value.scope === "workspace" ? "Workspace" : "Personal"}
      </span>
    </span>
    <Tooltip>
      <TooltipTrigger render={<span className="shrink-0" tabIndex={0} aria-label={`Added by ${value.createdBy.name}`} />}>
        <Avatar className="size-5 bg-input">
          <AvatarFallback className="text-[9px] font-semibold text-foreground">{initials(value.createdBy.name)}</AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>Added by {value.createdBy.name}</TooltipContent>
    </Tooltip>
    <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground max-sm:hidden">{day(value.createdAt)}</span>
    <span className="flex size-6 shrink-0 items-center justify-center">
      {value.removable && <Button variant="ghost" size="icon-xs" aria-label={`Remove ${value.key}`}
        className="size-6 bg-input text-muted-foreground hover:text-foreground [@media(hover:hover)]:opacity-0 group-hover/item:!opacity-100 group-focus-within/item:!opacity-100 [&_svg:not([class*='size-'])]:size-[13px]"
        onClick={onRemove}>
        <Trash2 strokeWidth={1.8} />
      </Button>}
    </span>
  </Item>;
}

/// Several values at once, typed or pasted from a .env file. New rows are
/// Workspace variables, the common case.
function AddValuesDialog({ open, onOpenChange, path, workspaceName, organizationName, personal }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
  workspaceName: string;
  organizationName: string;
  personal: boolean;
}) {
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const change = (id: string, patch: Partial<Draft>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  const filled = rows.filter(row => row.key.trim() || row.value);
  const invalid = filled.some(row => !isEnvironmentKey(row.key.trim()));
  const reset = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setRows([blank()]);
  };
  const paste = (row: Draft, event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!/[\r\n]/.test(text) && !/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text)) return;
    const parsed = parseEnvironmentText(text);
    if (!parsed.length) return;
    event.preventDefault();
    setRows(current => {
      const at = current.findIndex(entry => entry.id === row.id);
      const pasted = parsed.map(entry => ({ ...blank(), kind: row.kind, scope: row.scope, ...entry }));
      return [...current.slice(0, at), ...pasted, ...current.slice(at + 1)];
    });
  };
  const submit = async () => {
    if (!filled.length || invalid) return;
    setBusy(true);
    try {
      await hubRequest(path, "POST", { values: filled.map(({ key, value, kind, scope }) => ({ key: key.trim(), value, kind, scope })) });
      toast.success(filled.length === 1 ? `${filled[0]!.key.trim()} is added.` : `${filled.length} values are added.`);
      setBusy(false);
      onOpenChange(false);
      setRows([blank()]);
    } catch (cause) {
      toast.error("Couldn't add these values", { description: apiError(cause) });
      setBusy(false);
    }
  };
  return <Dialog open={open} onOpenChange={reset}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] w-[760px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl border-input bg-popover p-0 sm:max-w-[760px]">
      <form className="flex min-h-0 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-[18px]">
          <DialogTitle className="min-w-0 truncate text-[15px] leading-5 font-semibold">Add values to {workspaceName}</DialogTitle>
          <DialogClose render={<Button type="button" variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label="Close" disabled={busy} />}>
            <X strokeWidth={1.8} />
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-col gap-[18px] overflow-y-auto p-5">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span id="environment-values" className="text-xs font-medium">Values</span>
              <span className="text-right text-xs text-muted-foreground">Paste a .env file to fill these in.</span>
            </div>
            <div role="group" aria-labelledby="environment-values" className="flex flex-col gap-1.5">
              {rows.map((row, index) => {
                const bad = !!(row.key.trim() || row.value) && !isEnvironmentKey(row.key.trim());
                return <div key={row.id} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                  <Input aria-label={`Key ${index + 1}`} placeholder="KEY" value={row.key} autoFocus={index === 0} spellCheck={false} autoComplete="off" autoCapitalize="off"
                    aria-invalid={bad || undefined}
                    className="h-8 min-w-0 flex-1 rounded-lg px-2.5 font-mono text-xs md:text-xs sm:w-[190px] sm:flex-none"
                    onChange={event => change(row.id, { key: event.target.value })} onPaste={event => paste(row, event)} />
                  <Input aria-label={`Value ${index + 1}`} placeholder="value" value={row.value} type={row.kind === "secret" ? "password" : "text"} spellCheck={false} autoComplete={row.kind === "secret" ? "new-password" : "off"}
                    className="h-8 min-w-0 flex-1 basis-full rounded-lg px-2.5 font-mono text-xs md:text-xs sm:basis-0 max-sm:order-last"
                    onChange={event => change(row.id, { value: event.target.value })} />
                  <Segmented<Kind> aria-label={`Kind ${index + 1}`} value={row.kind} onValueChange={kind => change(row.id, { kind })} className="h-8 shrink-0 bg-transparent">
                    <SegmentedItem value="variable" className="flex-none px-2 data-[pressed]:font-medium">Variable</SegmentedItem>
                    <SegmentedItem value="secret" className="flex-none px-2 data-[pressed]:font-medium">Secret</SegmentedItem>
                  </Segmented>
                  <Segmented<Scope> aria-label={`Scope ${index + 1}`} value={row.scope} onValueChange={scope => change(row.id, { scope })} className="h-8 shrink-0 bg-transparent">
                    <SegmentedItem value="workspace" className="flex-none px-2 data-[pressed]:font-medium">Workspace</SegmentedItem>
                    <SegmentedItem value="personal" className="flex-none px-2 data-[pressed]:font-medium">Personal</SegmentedItem>
                  </Segmented>
                  <Button type="button" variant="ghost" size="icon-xs" className="ml-auto size-7 shrink-0 text-muted-foreground sm:ml-0" aria-label={`Remove row ${index + 1}`}
                    disabled={rows.length === 1 && !row.key && !row.value}
                    onClick={() => setRows(current => current.length === 1 ? [blank()] : current.filter(entry => entry.id !== row.id))}>
                    <X strokeWidth={1.8} />
                  </Button>
                </div>;
              })}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 self-start rounded-[7px] px-2 text-xs font-[450] text-muted-foreground has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3" onClick={() => setRows(current => [...current, blank()])}>
              <Plus strokeWidth={1.8} />
              Add value
            </Button>
          </div>
          <p className="text-xs leading-4 text-muted-foreground">
            {personal
              ? "Workspace values reach every thread in this workspace. Personal values are only yours and reach every thread you start."
              : `Workspace values reach everyone in ${organizationName} who runs a thread here. Personal values are only yours and reach every thread you start.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
          <span className="mr-auto text-xs text-muted-foreground">Secrets are encrypted and never shown again.</span>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" disabled={busy} onClick={() => reset(false)}>Cancel</Button>
          <Button type="submit" size="sm" className="h-8 rounded-lg px-3 text-xs" disabled={busy || !filled.length || invalid}>
            {busy && <Spinner data-icon="inline-start" />}
            Add values
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
