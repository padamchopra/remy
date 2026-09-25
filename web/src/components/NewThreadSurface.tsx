import { DropdownMenuTrigger } from "./ui/dropdown-menu";
import type { ComponentProps, ReactNode } from "react";

export function NewThreadSurface({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
    <div className="flex w-full min-w-0 max-w-2xl flex-col gap-8">
      <h2 className="flex flex-wrap items-center justify-center gap-x-1.5 text-3xl font-medium leading-none tracking-tight"><span>What do you want to do in</span>{heading}<span>?</span></h2>
      {children}
    </div>
  </div>;
}

export function ComposerWorkspaceTrigger(props: ComponentProps<typeof DropdownMenuTrigger>) {
  return <DropdownMenuTrigger type="button" className="inline-flex appearance-none items-center gap-1.5 whitespace-nowrap border-x-0 border-t-0 border-b border-dotted border-muted-foreground bg-transparent p-0 font-[inherit] text-[inherit] leading-none outline-none" {...props} />;
}
