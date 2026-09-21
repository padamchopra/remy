import { AvatarGroup, AvatarGroupCount } from "./ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AvatarFrom } from "./UserAvatar";

export type ThreadPerson = {id: string; label: string; image?: string | null};

/// Who can see a shared thread. The provider has its own glyph in the row's
/// icon lane now, so this is people and nothing else.
export function ThreadAvatars({people}: {people: ThreadPerson[]}) {
  const users = [...new Map(people.map(person => [person.id, person])).values()];
  const visible = users.length > 3 ? users.slice(0, 2) : users;
  const hidden = users.slice(visible.length);
  const face = "size-4 bg-sidebar ring-0 [&_svg]:size-2.5";
  return <AvatarGroup className="shrink-0 space-x-0 gap-0.5" aria-label="Thread participants">
    {visible.map(person => <Tooltip key={person.id}>
      <TooltipTrigger asChild><span className="relative inline-flex" aria-label={person.label}>
        <AvatarFrom avatar={person.image ?? ""} label={person.label} className={face} />
      </span></TooltipTrigger>
      <TooltipContent>{person.label}</TooltipContent>
    </Tooltip>)}
    {hidden.length > 0 && <Tooltip><TooltipTrigger asChild><span className="relative inline-flex"><AvatarGroupCount className="size-4 bg-sidebar text-[8px] ring-0" aria-label={`${hidden.length} more participants`}>+{hidden.length}</AvatarGroupCount></span></TooltipTrigger><TooltipContent>{hidden.map(person => person.label).join(", ")}</TooltipContent></Tooltip>}
  </AvatarGroup>;
}
