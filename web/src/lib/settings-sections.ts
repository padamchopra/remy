import { Boxes, GitBranch, Laptop, Link2, Monitor } from "lucide-react";

export type SettingsTab = "organization" | "general" | "version-control" | "providers" | "devices" | "members" | "teams" | "connections";

/// The settings tabs, listed here rather than beside the pane they open so the
/// sidebar can draw them without loading it.
export const SETTINGS_SECTIONS: {
  id: SettingsTab;
  label: string;
  icon: typeof Monitor;
}[] = [
  { id: "general", label: "General", icon: Monitor },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "version-control", label: "Version control", icon: GitBranch },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "devices", label: "Computers", icon: Laptop },
];
