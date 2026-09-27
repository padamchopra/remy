import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/// Base UI's toggle as a pill: one of several things you can turn on
/// independently, such as which providers members may start with.
function ToggleChip({ className, children, ...props }: React.ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="toggle-chip"
      className={cn(
        "group/chip inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground outline-none transition-colors",
        "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        "data-[pressed]:border-info/40 data-[pressed]:bg-info/10 data-[pressed]:text-foreground",
        className
      )}
      {...props}
    >
      <CheckIcon aria-hidden className="hidden size-3 text-info group-data-[pressed]/chip:block" />
      {children}
    </TogglePrimitive>
  )
}

export { ToggleChip }
