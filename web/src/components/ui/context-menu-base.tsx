import type { ComponentProps } from "react";
import { ContextMenu as Primitive } from "@base-ui/react/context-menu";
import { cn } from "@/lib/utils";

const ContextMenu = Primitive.Root;
const ContextMenuTrigger = Primitive.Trigger;

function ContextMenuContent({ className, ...props }: ComponentProps<typeof Primitive.Popup>) {
  return <Primitive.Portal><Primitive.Positioner className="z-50" collisionPadding={8}>
    <Primitive.Popup className={cn("min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none", className)} {...props} />
  </Primitive.Positioner></Primitive.Portal>;
}

function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4", className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem };
