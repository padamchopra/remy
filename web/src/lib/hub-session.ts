export type HubRuntime = {
  mode: "hub";
  auth: { magicLink: boolean; google: boolean; github: boolean; sso: boolean };
};
let hostedRuntime = false;

export const isHostedRuntime = () => hostedRuntime;

export async function readRuntime(): Promise<HubRuntime | undefined> {
  if (window.remy || window.missionControl) return;
  try {
    const response = await fetch("/api/runtime", {
      credentials: "same-origin",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return;
    const value = await response.json();
    hostedRuntime = value.mode === "hub";
    return value.mode === "hub" ? value : undefined;
  } catch {
    return;
  }
}
