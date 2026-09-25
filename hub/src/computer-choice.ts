import { cloudComputerProvider, type HostedSettings } from "@remy/contract";
import type { ComputerSummary } from "@remy/contract";
import { repositoryOrigin } from "./organizations.js";

/// Which computer a new thread runs on.
///
/// The person's own choice wins. Otherwise a cloud computer this account already
/// has takes it, and one is prepared when there is none.
export type ComputerChoiceInput = {
  workspaceId: string;
  origin: string;
  /// The computer the person picked, or the one they last chose for this
  /// workspace.
  override?: string;
  enabledProviders?: string[];
};

export function chooseComputer(
  computers: ComputerSummary[],
  input: ComputerChoiceInput,
): {
  computerId?: string;
  workspaceId?: string;
  hostedWorkspaceId?: string;
  hostedProvider?: HostedSettings["provider"];
  reason: string;
} {
  const holds = (workspace: { id: string; origin?: string | null }) =>
    workspace.id === input.workspaceId
    || (!!workspace.origin && repositoryOrigin(workspace.origin) === repositoryOrigin(input.origin));
  const eligible = computers.filter(
    (computer) =>
      computer.canUse
      && computer.availability !== "offline"
      && !computer.updateRequired
      && computer.capabilities.workspaces.some(holds),
  );
  const result = (computer: ComputerSummary, reason: string) => ({
    computerId: computer.computerId,
    workspaceId: computer.capabilities.workspaces.find(holds)!.id,
    reason,
  });
  const cloudChoice = (id: string) => {
    const provider = cloudComputerProvider(id);
    return provider && input.enabledProviders?.includes(provider)
      ? { hostedWorkspaceId: input.workspaceId, hostedProvider: provider, reason: "Your selected cloud provider." }
      : { reason: "Your cloud provider is disabled; choose another computer." };
  };
  if (input.override) {
    if (cloudComputerProvider(input.override)) return cloudChoice(input.override);
    const picked = eligible.find((computer) => computer.computerId === input.override);
    return picked
      ? result(picked, "Your workspace preference.")
      : { reason: "Your preferred computer is unavailable; choose another computer." };
  }
  const cloud = eligible.find((computer) => computer.ownership === "hosted");
  return cloud
    ? result(cloud, "Your cloud computer is the default.")
    : { hostedWorkspaceId: input.workspaceId, reason: "Preparing your cloud computer." };
}
