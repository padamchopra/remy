import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

/// Base UI's collapsible, for new surfaces and redesigns. `ui/collapsible.tsx`
/// is the Radix one the rest of the app still uses. The trigger carries
/// `data-panel-open` while its panel shows.
function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent({ className, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" className={cn("min-w-0", className)} {...props} />
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
