import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/// The look of a tab strip, shared by a thread's workbench and the draft pane
/// before a thread exists, so the two read as the same kind of place.

/// A tab: a soft filled pill when in front, quiet text otherwise.
export const tabTriggerClass = cn(
  "h-8 max-w-48 flex-none gap-1.5 rounded-md border-transparent px-2.5 text-[13px] font-normal text-muted-foreground shadow-none",
  "data-[state=active]:bg-foreground/8 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-foreground/8",
);

/// The strip's list: no container, scrolls sideways when the tabs outgrow it.
export const tabListClass = "h-auto min-w-0 flex-1 justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none bg-transparent p-0 scrollbar-thin";

/// A tab's content: mounted behind the front one, shown only when in front.
export const tabContentClass = "flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden";

/// The row a group's tabs sit in: the strip on the left, its controls on the right.
export function TabStrip({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-2 pl-2">
      {children}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/// Room inside a tab for its close control, which sits over the tab's trailing
/// edge so the strip does not widen on hover.
export function TabCloseSpace() {
  return <span aria-hidden className="w-4 shrink-0" />;
}

/// The close control beside a tab. A sibling rather than a child, since a
/// button inside a button is not markup a browser will honour. On a pointer
/// device it appears on hover and on the tab in front.
export function TabClose({ label, active, onClose }: { label: string; active: boolean; onClose: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Close ${label}`}
      className={cn(
        "-ml-6 size-5 rounded-sm text-muted-foreground hover:text-foreground",
        "[@media(hover:hover)]:opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
        active && "[@media(hover:hover)]:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <X />
    </Button>
  );
}
