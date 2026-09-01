import { Boxes, ChartNoAxesCombined, GitBranch, Laptop, Monitor } from "lucide-react";

export type SettingsTab = "general" | "version-control" | "providers" | "devices" | "analytics";

/// The settings tabs, listed here rather than beside the pane they open so the
/// sidebar can draw them without loading it.
export const SETTINGS_SECTIONS: {
  id: SettingsTab;
  label: string;
  icon: typeof Monitor;
}[] = [
  { id: "general", label: "General", icon: Monitor },
  { id: "version-control", label: "Version control", icon: GitBranch },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "devices", label: "Devices", icon: Laptop },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
];
