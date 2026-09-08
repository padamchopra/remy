import type { ComputerSummary, RoutingRule } from "@remy/contract";
import { repositoryOrigin } from "./organizations.js";
export type RoutingInput = {workspaceId:string;origin:string;teamIds:string[];trigger:string;override?:string};
export function resolveComputer(rules:RoutingRule[], computers:ComputerSummary[], input:RoutingInput): {computerId?:string;workspaceId?:string;hostedWorkspaceId?:string;reason:string} {
  const eligible=computers.filter(c=>c.canUse && c.availability!=="offline" && !c.updateRequired && c.capabilities.workspaces.some(w=>w.id===input.workspaceId || (!!w.origin && repositoryOrigin(w.origin)===repositoryOrigin(input.origin))));
  const result=(c:ComputerSummary,reason:string)=>({computerId:c.computerId,workspaceId:c.capabilities.workspaces.find(w=>w.id===input.workspaceId || (!!w.origin && repositoryOrigin(w.origin)===repositoryOrigin(input.origin)))!.id,reason});
  if(input.override){const c=eligible.find(c=>c.computerId===input.override);return c?result(c,"Your workspace preference."):{reason:"Your preferred computer is unavailable; choose another computer."};}
  for(const rule of rules) {
    if(rule.workspaceId && rule.workspaceId!==input.workspaceId || rule.teamId && !input.teamIds.includes(rule.teamId) || rule.trigger && rule.trigger!==input.trigger)continue;
    const c=eligible.find(c=>(!rule.target.computerId || c.computerId===rule.target.computerId) && (!rule.target.class || (rule.target.class==="hosted"?c.ownership==="hosted":c.platform===rule.target.class)) && (!rule.target.emulator || c.capabilities.emulator));
    if(c)return result(c,`Matched ${rule.name}.`);
  }
  const hosted=eligible.find(c=>c.ownership==="hosted");
  return hosted?result(hosted,"Your hosted computer is the default."):{hostedWorkspaceId:input.workspaceId,reason:"Preparing your hosted computer."};
}
