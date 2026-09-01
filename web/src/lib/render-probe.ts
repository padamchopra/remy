declare global {
  interface Window {
    __remyRenderProbe?: (surface: string, id: string) => void;
  }
}

/// Reports component renders only when the performance harness installs a probe.
export function reportRender(surface: string, id: string): void {
  window.__remyRenderProbe?.(surface, id);
}
