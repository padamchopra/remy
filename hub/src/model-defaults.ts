import { cloudComputerProvider } from "@remy/contract";
import { ComputerService } from "./computers.js";
import { D1ComputerStore } from "./computer-store.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
type Choice = {provider:string;model:string;effort:string};
/// `own:` ids are a default picked from your own Personal key in an organization.
const MODEL_DEFAULT_PROVIDERS=["claude","codex","cursor","anthropic","openai","router","openrouter","own:anthropic","own:openai","own:router","own:openrouter"];
/// Your default model on one computer. A workspace has none of its own: the
/// composer's pick and the computer are the only choices.
export async function modelDefaults(db:D1Database, org:string, user:string, request:Request):Promise<Response> {
  await new OrganizationService(new D1OrganizationStore(db)).member(org,user);
  const computerId=new URL(request.url).searchParams.get("computer");
  if(computerId && !cloudComputerProvider(computerId)) await new ComputerService(new D1ComputerStore(db),Date.now,"0.1.0",new D1OrganizationStore(db)).requireUse(org,computerId,user);
  if(request.method==="PATCH") {
    if(!computerId) return Response.json({error:"Choose a computer."},{status:400});
    const input=await request.json().catch(()=>null) as {choice?:Partial<Choice>|null}|null;
    const choice=input?.choice;
    if(!input || choice===undefined || (choice!==null && (typeof choice!=="object" || !MODEL_DEFAULT_PROVIDERS.includes(choice.provider??"") || typeof choice.model!=="string" || choice.model.length>512 || (choice.effort!==undefined && (typeof choice.effort!=="string" || choice.effort.length>64))))) return Response.json({error:"Choose a default model."},{status:400});
    if(choice===null) await db.prepare("DELETE FROM member_computer_model_defaults WHERE organization_id=? AND user_id=? AND computer_id=?").bind(org,user,computerId).run();
    else await db.prepare("INSERT INTO member_computer_model_defaults(organization_id,user_id,computer_id,provider,model,effort) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,user_id,computer_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,effort=excluded.effort").bind(org,user,computerId,choice.provider,choice.model,choice.effort??"").run();
  }
  const computer=computerId ? await db.prepare("SELECT provider,model,effort FROM member_computer_model_defaults WHERE organization_id=? AND user_id=? AND computer_id=?").bind(org,user,computerId).first<Choice>() : null;
  return Response.json({computer},{headers:{"cache-control":"no-store"}});
}
