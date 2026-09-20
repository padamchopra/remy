import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/// Base UI's menu, for new surfaces and redesigns. `ui/dropdown-menu.tsx` is
/// the Radix one the rest of the app still uses.
function Menu({ ...props }: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuTrigger({ ...props }: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuContent({
  className,
  sideOffset = 4,
  align = "start",
  side,
  ...popup
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<React.ComponentProps<typeof MenuPrimitive.Positioner>, "sideOffset" | "align" | "side">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={sideOffset} align={align} side={side} className="z-50">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            "max-h-[var(--available-height)] min-w-[8rem] origin-[var(--transform-origin)] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className
          )}
          {...popup}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/// The trailing check that marks the chosen row, per the menu convention in
/// `.agents/skills/ui`.
function MenuItemCheck({ checked }: { checked: boolean }) {
  return <CheckIcon className={cn("ml-auto size-4 shrink-0", checked ? "opacity-100" : "opacity-0")} />
}

export { Menu, MenuContent, MenuItem, MenuItemCheck, MenuTrigger }
