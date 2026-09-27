import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@remy/contract";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Menu, MenuContent, MenuItem, MenuItemCheck, MenuTrigger } from "./ui/menu-base";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog-base";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { watchHubComputers } from "@/lib/hub-computers";
import { apiError } from "@/lib/api-error";

const INSTALL = "npm i -g @padamchopra/remy";

/// Signing a Mac or Linux machine in: choose the account, then three commands.
/// The key is made when the dialog opens because it works once and expires,
/// and the dialog opens the computer's page when it signs in.
export function HubConnectComputerDialog({ open, onOpenChange, accounts, initial, onConnected }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /// Personal first, then the organizations you administer.
  accounts: Organization[];
  initial?: string;
  onConnected: (organizationId: string, computerId: string) => void;
}) {
  const [accountId, setAccountId] = useState(initial ?? accounts[0]?.id ?? "");
  const account = accounts.find(entry => entry.id === accountId) ?? accounts[0];
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyFailed, setKeyFailed] = useState(false);
  const known = useRef<Set<string>>(undefined);
  useEffect(() => { if (open) setAccountId(initial && accounts.some(entry => entry.id === initial) ? initial : accounts[0]?.id ?? ""); }, [open, initial, accounts]);
  const create = async () => {
    if (!account) return;
    setBusy(true);
    setKeyFailed(false);
    try {
      const result = await hubRequest<{ key: string }>(`${hubThreadBase(account.id)}/computers/connection-keys`, "POST", { ownership: account.personal ? "personal" : "organization" });
      setCommand(`remy login ${result.key}`);
    } catch (error) {
      setKeyFailed(true);
      toast.error("Couldn't create a connection key", { description: apiError(error) });
    } finally { setBusy(false); }
  };
  useEffect(() => {
    setCommand("");
    if (!open || !account) return;
    void create();
    known.current = undefined;
    // The first list is what was already here; anything after it is the new one.
    return watchHubComputers(account.id, computers => {
      const ids = new Set(computers.filter(computer => computer.ownership !== "hosted").map(computer => computer.computerId));
      if (!known.current) { known.current = ids; return; }
      const added = [...ids].find(id => !known.current!.has(id));
      if (added) { onConnected(account.id, added); onOpenChange(false); }
    }, () => {});
    // `create` reads the account it is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-5 sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Connect a computer</DialogTitle>
        <DialogDescription>Run threads in the folders on a Mac or Linux machine.</DialogDescription>
      </DialogHeader>
      {accounts.length > 1 && <div className="flex min-w-0 items-center gap-4">
        <span className="flex-1 text-[13px] font-medium">Account</span>
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="sm" className="h-8 w-52 justify-between rounded-lg text-[13px] font-normal" />}>
            <span className="truncate">{account?.personal ? "Personal" : account?.name}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuContent align="end" className="w-52">
            {accounts.map(entry => <MenuItem key={entry.id} onClick={() => setAccountId(entry.id)}>
              <span className="truncate">{entry.personal ? "Personal" : entry.name}</span>
              <MenuItemCheck checked={entry.id === account?.id} />
            </MenuItem>)}
          </MenuContent>
        </Menu>
      </div>}
      <ol className="flex min-w-0 flex-col gap-5">
        <Step n={1} title="Install the Remy CLI"><Command text={INSTALL} /></Step>
        <Step n={2} title="Sign it in">
          {command ? <Command text={command} /> : <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-xs text-muted-foreground">{keyFailed ? "Couldn't make a key. Try a new one." : <><Spinner />Making a key</>}</div>}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">The key works once, within 15 minutes.
            <Button variant="link" size="sm" className="h-auto p-0 text-xs text-foreground/80" disabled={busy} onClick={() => void create()}>New key</Button>
          </p>
        </Step>
        <Step n={3} title="Keep it connected"><Command text="remy start" /></Step>
      </ol>
      <DialogFooter className="items-center border-t pt-4 sm:justify-between">
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Spinner className="shrink-0" />Waiting for your computer. It opens here when it signs in.</p>
        <div className="flex shrink-0 items-center gap-3">
          <a className="text-xs text-info hover:underline" href="https://tryremy.dev/docs/#installation" target="_blank" rel="noreferrer" data-link>Setup guide</a>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return <li className="flex min-w-0 gap-3">
    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px]">{n}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="text-[13px] leading-[22px] font-medium">{title}</span>
      {children}
    </div>
  </li>;
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error("Couldn't copy that", { description: "Select the command and copy it." }); }
  };
  return <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-background pr-1 pl-3">
    <code className="min-w-0 flex-1 truncate font-mono text-xs" title={text}>{text}</code>
    <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-md" aria-label={copied ? "Copied" : `Copy ${text.split(" ").slice(0, 2).join(" ")}`} onClick={() => void copy()}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  </div>;
}
