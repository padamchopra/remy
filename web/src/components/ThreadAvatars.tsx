import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "./ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AvatarFrom } from "./UserAvatar";
import { ProviderMark } from "./ProviderMark";
import { PROVIDERS, providerLabel } from "@/lib/providers";

export type ThreadPerson = {id: string; label: string; image?: string | null};

export function ThreadAvatars({people, provider, model}: {people: ThreadPerson[]; provider?: string; model?: string}) {
  const users = [...new Map(people.map(person => [person.id, person])).values()];
  const modelName = [providerLabel(PROVIDERS, provider), model?.replace(/^remy:[^:]+:/, "")].filter(Boolean).join(" · ");
  const entries = [
    ...users.slice(0, 1).map(person => ({id: `user:${person.id}`, label: person.label, person})),
    {id: "model", label: modelName, person: undefined},
    ...users.slice(1).map(person => ({id: `user:${person.id}`, label: person.label, person})),
  ];
  const visible = entries.length > 3 ? entries.slice(0, 2) : entries;
  const hidden = entries.slice(visible.length);
  const face = "size-5 bg-sidebar ring-0 [&_svg]:size-3";
  return <AvatarGroup className="shrink-0 space-x-0 gap-0.5" aria-label="Thread participants">
    {visible.map(entry => <Tooltip key={entry.id}>
      <TooltipTrigger asChild><span className="relative inline-flex" aria-label={entry.label}>
        {entry.person ? <AvatarFrom avatar={entry.person.image ?? ""} label={entry.person.label} className={face} /> :
          <Avatar className={face}><AvatarFallback className={provider === "claude" ? "bg-claude/15" : "bg-muted"}><ProviderMark provider={provider} className="size-3" /></AvatarFallback></Avatar>}
      </span></TooltipTrigger>
      <TooltipContent>{entry.label}</TooltipContent>
    </Tooltip>)}
    {hidden.length > 0 && <Tooltip><TooltipTrigger asChild><span className="relative inline-flex"><AvatarGroupCount className="size-5 bg-sidebar text-[9px] ring-0" aria-label={`${hidden.length} more participants`}>+{hidden.length}</AvatarGroupCount></span></TooltipTrigger><TooltipContent>{hidden.map(entry => entry.label).join(", ")}</TooltipContent></Tooltip>}
  </AvatarGroup>;
}
