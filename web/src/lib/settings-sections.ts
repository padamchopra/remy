import { Bot, Boxes, ChartNoAxesCombined, GitBranch, Laptop, Link2, Monitor } from "lucide-react";

export type SettingsTab = "organization" | "environments" | "general" | "agents" | "version-control" | "providers" | "devices" | "analytics" | "members" | "teams" | "routing" | "connections";

/// The settings tabs, listed here rather than beside the pane they open so the
/// sidebar can draw them without loading it.
export const SETTINGS_SECTIONS: {
  id: SettingsTab;
  label: string;
  icon: typeof Monitor;
}[] = [
  { id: "environments", label: "Environments", icon: Boxes },
  { id: "general", label: "General", icon: Monitor },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "version-control", label: "Version control", icon: GitBranch },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "devices", label: "Computers", icon: Laptop },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
];
