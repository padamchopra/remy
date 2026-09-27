import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

/// Base UI's avatar, for new surfaces and redesigns. `ui/avatar.tsx` is the
/// Radix one the rest of the app still uses.
function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn("relative inline-flex size-5 shrink-0 overflow-hidden rounded-full bg-muted align-middle select-none", className)}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("size-full object-cover", className)} {...props} />
}

function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center text-[0.6em] font-medium text-muted-foreground uppercase", className)}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarImage }
