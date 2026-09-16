import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";

export interface WorkspaceComputerBadge {
  id: string;
  name: string;
  icon?: DeviceIconId;
  tint?: string;
  online: boolean;
  status?: string;
}

export function WorkspaceComputerBadges({ computers }: { computers: WorkspaceComputerBadge[] }) {
  if (!computers.length) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" role="group" aria-label="Workspace computers">
      {computers.map((computer) => {
        const Icon = deviceIcon(computer.icon);
        const colors = tintOf(computer.tint);
        const label = `${computer.name} · ${computer.status ?? (computer.online ? "Online" : "Offline")}`;
        return (
          <Tooltip key={computer.id}>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-label={label} className={cn("relative flex size-6 items-center justify-center rounded-full border border-background", colors.well, colors.fg)}>
                <Icon className="size-3" />
                <span className={cn("absolute -right-0 -bottom-0 size-1.5 rounded-full ring-1 ring-background", computer.online ? "bg-success" : "bg-muted-foreground")} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
