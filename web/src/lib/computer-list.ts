import { useEffect, useMemo, useState } from "react";
import type { ComputerSummary, HubThread, Organization } from "@remy/contract";
import { watchHubComputers } from "./hub-computers";
import { watchHubThreads } from "./hub-threads";
import { agoLabel } from "./elapsed";

/// One computer as the Computers list shows it: the account whose settings
/// hold it, which is the account that owns it when you can see that one.
export type ListedComputer = { computer: ComputerSummary; account: Organization };

const LIVE = ["running", "working", "waiting", "needs_input"];
export const threadIsLive = (thread: HubThread) => LIVE.includes(String(thread.detail.state));

export function lastSeen(at: number, now = Date.now()): string {
  const label = agoLabel(at, now);
  return label === "now" ? "just now" : `${label} ago`;
}

export const platformLabel = (platform: string) => platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;

/// Every connected computer you can use across the accounts in view. A
/// computer shared into an organization appears there too, so it is listed
/// once, under the account you can manage it from.
export function useComputersAcross(accounts: Organization[]) {
  const ids = accounts.map(account => account.id).join(",");
  const [byAccount, setByAccount] = useState<Record<string, { computers: ComputerSummary[]; stale: boolean }>>({});
  const [threadsByAccount, setThreadsByAccount] = useState<Record<string, HubThread[]>>({});
  // One account that cannot be read leaves the others on screen.
  const [failed, setFailed] = useState<Record<string, string>>({});
  useEffect(() => {
    setByAccount({});
    setThreadsByAccount({});
    setFailed({});
    const offs = ids.split(",").filter(Boolean).flatMap(id => [
      watchHubComputers(id, (computers, stale) => {
        setByAccount(current => ({ ...current, [id]: { computers, stale } }));
        setFailed(current => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; });
      }, message => setFailed(current => ({ ...current, [id]: message }))),
      watchHubThreads(id, threads => setThreadsByAccount(current => ({ ...current, [id]: threads })), () => {}),
    ]);
    return () => { for (const off of offs) off(); };
  }, [ids]);
  const listed = useMemo(() => {
    const seen = new Map<string, ListedComputer>();
    for (const account of accounts) {
      for (const computer of byAccount[account.id]?.computers ?? []) {
        if (computer.ownership === "hosted") continue;
        const current = seen.get(computer.computerId);
        // The account you can manage it from wins, then the one it is registered in.
        const rank = (entry: ListedComputer) => (entry.computer.canManage ? 2 : 0) + (entry.computer.organizationId === entry.account.id ? 1 : 0);
        const next = { computer, account };
        if (!current || rank(next) > rank(current)) seen.set(computer.computerId, next);
      }
    }
    return [...seen.values()].sort((a, b) => Number(b.computer.availability !== "offline") - Number(a.computer.availability !== "offline") || a.computer.name.localeCompare(b.computer.name));
  }, [accounts, byAccount]);
  const threads = useMemo(() => {
    const unique = new Map<string, HubThread>();
    for (const list of Object.values(threadsByAccount)) for (const thread of list) unique.set(`${thread.computerId}:${thread.id}`, thread);
    return [...unique.values()];
  }, [threadsByAccount]);
  const loaded = accounts.length > 0 && accounts.every(account => byAccount[account.id] || failed[account.id]);
  const stale = accounts.some(account => byAccount[account.id]?.stale);
  const unreadable = accounts.filter(account => failed[account.id] && !byAccount[account.id]);
  const error = unreadable.length === 0 ? ""
    : accounts.length === 1 ? failed[unreadable[0]!.id]!
    : `Couldn't read the computers in ${unreadable.map(account => account.personal ? "Personal" : account.name).join(", ")}.`;
  return { listed, threads, loaded, stale, error };
}
