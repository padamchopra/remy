import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/// Base UI's tooltip, for new surfaces and redesigns. `ui/tooltip.tsx` is the
/// Radix one the rest of the app still uses.
function TooltipProvider({ delay = 400, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  side = "bottom",
  align = "center",
  ...popup
}: React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<React.ComponentProps<typeof TooltipPrimitive.Positioner>, "sideOffset" | "side" | "align">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} side={side} align={align} collisionPadding={8} className="z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            // A tooltip is never the thing you meant to click, so it lets the
            // pointer through to whatever it describes.
            "pointer-events-none w-fit origin-[var(--transform-origin)] rounded-md bg-foreground px-2.5 py-1 text-xs text-balance text-background transition-[opacity,transform] duration-125 ease-out data-ending-style:scale-97 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-97 data-starting-style:opacity-0",
            className
          )}
          {...popup}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
