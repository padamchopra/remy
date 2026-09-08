import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readRuntime } from "@/lib/hub-session";

import "./index.css";

if (window.remy || window.missionControl) {
  document.documentElement.classList.add("electron");
}

const LocalApp = lazy(() => import("./App").then((m) => ({ default: m.App })));
const HubApp = lazy(() => import("@/components/HubApp"));
async function start() {
  const runtime = await readRuntime();
  if (!runtime) {
    const { useStore } = await import("@/state/store");
    void useStore.getState().refresh().catch(() => undefined);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode><TooltipProvider><Suspense fallback={<p className="p-6 text-muted-foreground">Opening Remy…</p>}>{runtime ? <HubApp runtime={runtime} /> : <LocalApp />}</Suspense><Toaster /></TooltipProvider></StrictMode>,
  );
}
void start();
