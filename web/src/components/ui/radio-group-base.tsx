import * as React from "react"
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"

/// Base UI's radio group, for new surfaces and redesigns.
function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive>) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn("grid w-full gap-3", className)} {...props} />
}

/// A chosen radio is a thick ring in the primary colour around the surface
/// behind it, not a dot on a filled circle.
function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "aspect-square size-4 shrink-0 rounded-full border border-input bg-transparent outline-none transition-[border-color,border-width]",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 data-checked:border-4 data-checked:border-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }
