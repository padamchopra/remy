import { GitBranch, Lock, UserRound, Users } from "lucide-react";
import { ProviderMark } from "@/components/ProviderMark";
import { deviceIcon } from "@/lib/devices";
import { modelLabel, providerLabel, PROVIDERS } from "@/lib/providers";
import { plainText } from "@/lib/path";
import { useStore } from "@/state/store";
import type { SidebarThread } from "./contract";

/// Everything the row had to say as an icon, said in words. The lines run in
/// the row's own left-to-right order so the card reads as its legend rather
/// than as a second, differently sorted list of the same facts.
export function SidebarThreadCard({ thread }: { thread: SidebarThread }) {
  const providers = useStore((state) => state.providers) ?? PROVIDERS;
  const DeviceIcon = deviceIcon(thread.computer?.icon);
  const model = thread.model
    ? modelLabel(providers, { provider: thread.provider ?? "claude", model: thread.model })
    : providerLabel(providers, thread.provider);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm leading-snug font-medium">{thread.title}</p>
      {thread.preview && (
        <p className="text-xs leading-relaxed text-muted-foreground">{plainText(thread.preview)}</p>
      )}
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {thread.workspace && (
          <span className="flex items-center gap-1.5">
            {thread.workspace.mark}
            <span className="min-w-0 truncate">{thread.workspace.name}</span>
          </span>
        )}
        {thread.branch && (
          <span className="flex items-center gap-1.5 font-mono break-all">
            <GitBranch className="size-3.5 shrink-0" />
            {thread.branch}
          </span>
        )}
        {thread.computer && (
          <span className="flex items-center gap-1.5">
            <DeviceIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{thread.computer.name}</span>
          </span>
        )}
        {model && (
          <span className="flex items-center gap-1.5">
            <ProviderMark provider={thread.provider} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{model}</span>
          </span>
        )}
        {thread.shared !== undefined && (
          <span className="flex items-center gap-1.5">
            {thread.shared ? <Users className="size-3.5 shrink-0" /> : <Lock className="size-3.5 shrink-0" />}
            {thread.shared ? "Shared" : "Private"}
          </span>
        )}
        {thread.people.length > 1 && (
          <span className="flex items-start gap-1.5">
            <UserRound className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{thread.people.map((person) => person.label).join(", ")}</span>
          </span>
        )}
      </div>
      {thread.ticket && (
        <button
          type="button"
          data-link
          className="flex flex-col gap-0.5 rounded border-t border-border pt-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={thread.ticket.onOpen}
        >
          <span className="font-mono text-[11px] text-muted-foreground">{thread.ticket.key}</span>
          {thread.ticket.title && <span className="text-xs leading-snug hover:underline">{thread.ticket.title}</span>}
        </button>
      )}
    </div>
  );
}
