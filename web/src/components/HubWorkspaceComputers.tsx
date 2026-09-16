import type { ComputerSummary } from "@remy/contract";
import { isDeviceIcon } from "@/lib/devices";
import { workspaceComputers } from "@/lib/hub-workspace-computers";
import { WorkspaceComputerBadges, type WorkspaceComputerBadge } from "./WorkspaceComputerBadges";

export function HubWorkspaceComputers({ origin, computers, cloudEnabled }: { origin: string; computers: ComputerSummary[]; cloudEnabled: boolean }) {
  const copies = workspaceComputers(origin, computers);
  const badges: WorkspaceComputerBadge[] = copies.map((computer) => ({
    id: computer.computerId,
    name: computer.name,
    icon: computer.ownership === "hosted" ? "cloud" : isDeviceIcon(computer.icon) ? computer.icon : "laptop",
    online: computer.availability !== "offline",
  }));
  if (cloudEnabled && !copies.some((computer) => computer.ownership === "hosted")) {
    badges.push({ id: "cloud", name: "Cloud", icon: "cloud", online: true, status: "Available" });
  }
  return <WorkspaceComputerBadges computers={badges} />;
}
