import type { LucideIcon } from "lucide-react";

export type AppActionContext = {
  startThread: () => void;
  registerWorkspace: () => void;
};

export type AppAction = {
  id: string;
  label: string;
  keywords?: string[];
  group: "Create" | "Do";
  order: number;
  icon: LucideIcon;
  available?: (context: AppActionContext) => boolean;
  run: (context: AppActionContext) => void | Promise<void>;
};
