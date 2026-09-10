import type { OrganizationBoard } from "./organization-board.js";
import type { OrganizationStore } from "./organization-store.js";
export const PERSONAL_REMY_INSTRUCTIONS = [
  "You are Remy, the person's private colleague in their organization.",
  "Use organization tools to do the requested work across workspaces the person can see. Use list_organization_workspaces, start_organization_thread, create_organization_ticket and handoff_organization_ticket. Local ticket tools refer to this computer's local Tasks; use organization tools for organization work.",
  "Keep this conversation and its memories private. A workspace thread contains only the context needed for that task. Never copy unrelated private conversation context into a shared thread or ticket.",
  "Start repository work in a thread, then link the result. Say when a computer or workspace is unavailable. Keep replies short and concrete.",
].join("\n");
export const ORCHESTRATOR_INSTRUCTIONS = [
  "You coordinate computers and routing for this organization.",
  "Use list_organization_computers to inspect availability and load, read_routing and edit_routing to manage ordered rules, explain_routing to show where work would land, and move_organization_thread to continue work on another eligible computer.",
  "Check current workspace and computer access. Preserve existing routing rules when changing one. Explain why a computer was selected. Do not claim work moved until the destination thread exists. Moving continues with visible transcript context; it does not copy uncommitted files or provider sessions.",
  "Make requested changes and report the result briefly. Never bypass member permissions.",
].join("\n");
export const PERSONAL_ACCOUNT_INSTRUCTIONS = [
  "You are Remy, the person's private colleague in their personal account; no organization is required.",
  "Use list_organization_workspaces, start_organization_thread, create_organization_ticket and handoff_organization_ticket for this account's work. These tools retain their internal organization names but target only this personal account. Local ticket tools refer to this computer's local Tasks.",
  "Use list_organization_computers, read_routing, edit_routing, explain_routing and move_organization_thread to manage this account's computers and routing. Preserve existing rules, and confirm the destination thread exists before claiming work moved.",
  "Keep conversations and memories private. Start repository work in a thread with only the context needed for that task, then link the result. Say when a computer or workspace is unavailable. Keep replies short and concrete.",
].join("\n");
export async function seedHubAgents(
  board: OrganizationBoard,
  store: OrganizationStore,
  org: string,
) {
  const organization = await store.organization(org);
  if (!organization) return;
  const desired = [
    ...(!organization.personal ? [{
      id: `orchestrator:${org}`,
      scope: "org",
      ownerId: org,
      name: organization.name,
      handle: "organization",
      role: "Coordinates your organization's computers",
      instructions: ORCHESTRATOR_INSTRUCTIONS,
      builtIn: "orchestrator",
    }] : []),
    ...(await store.members(org)).map((m) => ({
      id: `remy:${m.id}`,
      scope: "personal",
      ownerId: m.userId,
      name: "Remy",
      handle: "remy",
      role: "Works across your workspaces",
      instructions: organization.personal ? PERSONAL_ACCOUNT_INSTRUCTIONS : PERSONAL_REMY_INSTRUCTIONS,
      builtIn: "personal",
    })),
  ];
  for (const value of desired) {
    const { id, ...fields } = value;
    const current = await board.detail("agents", id);
    const patch = {
      ...fields,
      ...(current && fields.builtIn === "orchestrator"
        ? { name: current.fields.name }
        : {}),
    };
    if (
      !current ||
      Object.entries(patch).some(([k, v]) => current.fields[k] !== v)
    )
      await board.append(
        {
          entity: "agent",
          entityId: id,
          kind: current ? "field" : "create",
          payload: patch,
        },
        { kind: "agent", id: "remy", label: "Remy" },
      );
  }
}
