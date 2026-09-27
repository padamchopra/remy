import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { cn } from "@/lib/utils";

/// A titled group on a settings page: a heading, one line under it, and an
/// action on the right such as Add token.
export function SettingsSection({ id, title, description, action, children, className }: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-2.5", className)}>
    <div className="flex min-w-0 items-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={id} className="text-[13px] leading-[18px] font-semibold">{title}</h2>
        {description && <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>;
}

/// Rows in one bordered box. Each row draws the hairline above it.
export function SettingsList({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <ItemGroup aria-label={label} className={cn("min-w-0 overflow-hidden rounded-[10px] border", className)}>{children}</ItemGroup>;
}

/// The mark at the start of a row, in the same well everywhere.
export function RowMark({ children, className }: { children: ReactNode; className?: string }) {
  return <ItemMedia className={cn("size-8 rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4", className)}>{children}</ItemMedia>;
}

/// One row: a mark, a title and a line under it, then its state or actions.
/// `below` holds what opens inside the row, such as a key form.
export function SettingsRow({ media, title, description, children, below, className }: {
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  below?: ReactNode;
  className?: string;
}) {
  return <Item role="listitem" className={cn("min-w-0 flex-col flex-nowrap items-stretch gap-0 rounded-none border-0 border-border px-3.5 py-2.5 not-first:border-t", className)}>
    {/* On a narrow screen the actions drop under the title rather than squeezing it. */}
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {media}
      <ItemContent className="min-w-0 flex-1 basis-[10rem] gap-0.5">
        <ItemTitle className="w-full text-[13px] leading-[18px] whitespace-normal break-words">{title}</ItemTitle>
        {description && <ItemDescription className="text-xs leading-4 whitespace-normal break-words line-clamp-none">{description}</ItemDescription>}
      </ItemContent>
      {children && <ItemActions className="ml-auto max-w-full shrink-0 flex-wrap justify-end gap-2">{children}</ItemActions>}
    </div>
    {below && <div className="min-w-0 pt-3 pb-1 sm:pl-11">{below}</div>}
  </Item>;
}

/// A row that opens its own page.
export function SettingsLinkRow({ media, title, description, state, onOpen, label }: {
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  state?: ReactNode;
  onOpen: () => void;
  label: string;
}) {
  return <div role="listitem" className="min-w-0 border-border not-first:border-t"><Item asChild className="w-full min-w-0 flex-nowrap gap-3 rounded-none border-0 px-3.5 py-2.5 text-left hover:bg-accent/40">
    <button type="button" data-link aria-label={label} onClick={onOpen}>
      {media}
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full text-[13px] leading-[18px] whitespace-normal break-words">{title}</ItemTitle>
        {description && <ItemDescription className="text-xs leading-4 whitespace-normal break-words">{description}</ItemDescription>}
      </ItemContent>
      {state && <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground">{state}</span>}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  </Item></div>;
}

/// A dot and a word, for Online, Offline, On and Off.
export function StateDot({ on, children }: { on: boolean; children: ReactNode }) {
  return <>
    {on && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />}
    {!on && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
    <span className={on ? "text-foreground/80" : undefined}>{children}</span>
  </>;
}
