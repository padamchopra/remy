import { setProviderEnabled as setConfigProviderEnabled, type PublicSettings } from "./config.js";
import { provider } from "./providers.js";
import { resetWorkspacesUsingProvider } from "./workspaces.js";

export function setProviderEnabled(value: unknown, enabled: unknown): PublicSettings {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  if (typeof enabled !== "boolean") throw new Error("enabled must be true or false");
  const settings = setConfigProviderEnabled(selected.id, enabled);
  if (!enabled) {
    resetWorkspacesUsingProvider(selected.id);
  }
  return settings;
}
