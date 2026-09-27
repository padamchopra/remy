import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"

import { cn } from "@/lib/utils"

/// The look shared by a segmented choice and a segmented tab list: a sunken
/// track with the chosen segment raised in it.
export const segmentedTrack = "flex rounded-lg border border-border bg-sidebar/50 p-0.5"
export const segmentedSegment = cn(
  "inline-flex h-[26px] min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs leading-4 text-foreground/70 outline-none transition-colors",
  "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
)
const segmentedChosen = "bg-foreground/10 text-foreground"

/// Base UI's toggle group, holding one value: a segmented control such as a
/// rule's scope. For switching what a list shows, use `tabs-base` with the
/// same `segmentedTrack` and `segmentedSegment` looks.
function Segmented<Value extends string>({
  value,
  onValueChange,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupPrimitive>, "value" | "onValueChange" | "defaultValue"> & {
  value: Value
  onValueChange: (value: Value) => void
}) {
  return (
    <ToggleGroupPrimitive
      data-slot="segmented"
      value={[value]}
      onValueChange={(next) => { const chosen = next[0] as Value | undefined; if (chosen) onValueChange(chosen) }}
      className={cn(segmentedTrack, className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive>
  )
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="segmented-item"
      className={cn(segmentedSegment, "data-[pressed]:bg-foreground/10 data-[pressed]:text-foreground", className)}
      {...props}
    />
  )
}

export { Segmented, SegmentedItem, segmentedChosen }
