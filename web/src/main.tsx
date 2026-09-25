import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readRuntime } from "@/lib/hub-session";
import { normalizeLocation } from "@/lib/route";
import { AppLoading } from "@/components/AppLoading";

import "./index.css";

// Rewrite leftover `/app/inbox` before the hosted runtime fetch, so a full
// navigation's load waiter already sees Settings → Agents.
normalizeLocation();

const LocalApp = lazy(() => import("./App").then((m) => ({ default: m.App })));
const HubApp = lazy(() => import("@/components/HubApp"));
const root = createRoot(document.getElementById("root")!);
root.render(<AppLoading />);
async function start() {
  const runtime = await readRuntime();
  if (!runtime) {
    const { useStore } = await import("@/state/store");
    void useStore.getState().refresh().catch(() => undefined);
  }
  root.render(
    <StrictMode><TooltipProvider><Suspense fallback={<AppLoading />}>{runtime ? <HubApp runtime={runtime} /> : <LocalApp />}</Suspense><Toaster /></TooltipProvider></StrictMode>,
  );
}
void start();
