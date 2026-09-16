import { cloudComputerProvider } from "@remy/contract";
import { ComputerService } from "./computers.js";
import { D1ComputerStore } from "./computer-store.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
type Choice = {provider:string;model:string;effort:string};
export async function modelDefaults(db:D1Database, org:string, user:string, request:Request):Promise<Response> {
  const service=new OrganizationService(new D1OrganizationStore(db));
  await service.member(org,user);
  const workspaceId=new URL(request.url).searchParams.get("workspace");
  if(workspaceId) await service.workspace(org,user,workspaceId);
  const computerId=new URL(request.url).searchParams.get("computer");
  if(computerId && !cloudComputerProvider(computerId)) await new ComputerService(new D1ComputerStore(db),Date.now,"0.1.0",new D1OrganizationStore(db)).requireUse(org,computerId,user);
  if(request.method==="PATCH") {
    if(workspaceId && computerId) return Response.json({error:"Choose one default to change."},{status:400});
    const input=await request.json().catch(()=>null) as {choice?:Partial<Choice>|null}|null;
    const choice=input?.choice;
    if(!input || choice===undefined || (choice!==null && (typeof choice!=="object" || !["claude","codex","cursor","anthropic","openai","router","openrouter"].includes(choice.provider??"") || typeof choice.model!=="string" || choice.model.length>512 || (choice.effort!==undefined && (typeof choice.effort!=="string" || choice.effort.length>64))))) return Response.json({error:"Choose a default model."},{status:400});
    if(computerId) {
      if(choice===null) await db.prepare("DELETE FROM member_computer_model_defaults WHERE organization_id=? AND user_id=? AND computer_id=?").bind(org,user,computerId).run();
      else await db.prepare("INSERT INTO member_computer_model_defaults(organization_id,user_id,computer_id,provider,model,effort) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,user_id,computer_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,effort=excluded.effort").bind(org,user,computerId,choice.provider,choice.model,choice.effort??"").run();
    } else if(workspaceId) {
      if(choice===null) await db.prepare("DELETE FROM member_workspace_model_defaults WHERE user_id=? AND workspace_id=?").bind(user,workspaceId).run();
      else await db.prepare("INSERT INTO member_workspace_model_defaults(user_id,workspace_id,provider,model,effort) VALUES(?,?,?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,effort=excluded.effort").bind(user,workspaceId,choice.provider,choice.model,choice.effort??"").run();
    } else {
      if(choice===null) await db.prepare("DELETE FROM member_model_defaults WHERE user_id=?").bind(user).run();
      else await db.prepare("INSERT INTO member_model_defaults(user_id,provider,model,effort) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,effort=excluded.effort").bind(user,choice.provider,choice.model,choice.effort??"").run();
    }
  }
  const remy=await db.prepare("SELECT provider,model,effort FROM member_model_defaults WHERE user_id=?").bind(user).first<Choice>();
  const workspace=workspaceId ? await db.prepare("SELECT provider,model,effort FROM member_workspace_model_defaults WHERE user_id=? AND workspace_id=?").bind(user,workspaceId).first<Choice>() : null;
  const computer=computerId ? await db.prepare("SELECT provider,model,effort FROM member_computer_model_defaults WHERE organization_id=? AND user_id=? AND computer_id=?").bind(org,user,computerId).first<Choice>() : null;
  return Response.json({remy,workspace,computer},{headers:{"cache-control":"no-store"}});
}
