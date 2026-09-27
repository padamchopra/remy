import { preloadable } from "@/lib/preloadable";

/// The hosted thread pane, shared by every view that draws it so one download
/// and one preload serve them all.
export const hubThreads = preloadable(() => import("./HubThreads"));
export const hubAllView = preloadable(() => import("./HubAllView"));
