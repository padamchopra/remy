import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { useStore } from "@/state/store";
import "./index.css";

if (window.remy || window.missionControl) {
  document.documentElement.classList.add("electron");
}

// Every device is asked before the first frame is drawn rather than after it. A
// warm window has a whole sidebar and transcript to paint, and none of that work
// should stand between a machine and the question it is about to be asked. The
// connection itself is still opened and held by `App`, which joins this read.
void useStore.getState().refresh().catch(() => {
  // A machine that cannot answer is reported by the connection `App` holds.
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
