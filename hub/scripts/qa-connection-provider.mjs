import { createServer } from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";

export async function startConnectionProvider() {
  const codes=new Map(), comments=[], actions=[],linearComments=new Map(),linearIssues=new Map();let hubUrl;
  const initial={id:"11111111-1111-4111-8111-111111111111",identifier:"ENG-7",number:7,url:"https://linear.app/release/issue/ENG-7",title:"Review the release notes",description:"Check the September release.",updatedAt:new Date(Date.now()-3600000).toISOString(),team:{id:"linear-eng",key:"ENG"},project:{id:"linear-release-plan"},state:{id:"linear-todo",name:"Ready"},assignee:null,labels:{nodes:[{id:"linear-label",name:"Release"}]},parent:null};linearIssues.set(initial.id,initial);
  const emit=async(type,action,data,updatedFrom,actor={id:"linear-app",name:"Remy"})=>{if(!hubUrl)return;const raw=JSON.stringify({organizationId:"linear-release",type,action,data,updatedFrom,actor,webhookTimestamp:Date.now()});const response=await fetch(hubUrl+"/api/connections/linear/webhook",{method:"POST",headers:{"content-type":"application/json","linear-delivery":randomUUID(),"linear-signature":createHmac("sha256","disposable-linear-webhook").update(raw).digest("hex")},body:raw});if(!response.ok)throw Error("Fixture webhook rejected");};
  const changeIssue=async(id,patch,actor={id:"linear-ada",name:"Ada"})=>{const issue=linearIssues.get(id);if(!issue)throw Error("Missing fixture issue");const before={};for(const field of Object.keys(patch))before[field]=issue[field];Object.assign(issue,patch,{updatedAt:new Date().toISOString()});await emit("Issue","update",issue,before,actor);return issue;};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,"http://fixture.invalid");
    res.setHeader("content-type","application/json");
    if(url.pathname==="/authorize") {
      const code=randomUUID();codes.set(code,{challenge:url.searchParams.get("code_challenge"),redirect:url.searchParams.get("redirect_uri")});
      const target=new URL(url.searchParams.get("redirect_uri"));target.searchParams.set("code",code);target.searchParams.set("state",url.searchParams.get("state"));
      res.setHeader("content-type","text/html");res.end(`<html><body><h1>Connect Release team</h1><p>Allow Remy to use this disposable account.</p><a href="${target.href.replaceAll('&','&amp;')}">Allow connection</a></body></html>`);return;
    }
    if(url.pathname==="/token") {
      let raw="";for await(const part of req)raw+=part;
      const form=new URLSearchParams(raw),code=form.get("code"),saved=codes.get(code);
      if(form.get("grant_type")!=="refresh_token" && (!saved || saved.redirect!==form.get("redirect_uri") || saved.challenge!==createHash("sha256").update(form.get("code_verifier")??"").digest("base64url"))) {res.writeHead(400);res.end('{}');return;}
      codes.delete(code);res.end(JSON.stringify({access_token:"disposable-connection-token",refresh_token:"disposable-refresh-token",expires_in:3600}));return;
    }
    if(url.pathname==="/graphql") {
      let raw="";for await(const part of req)raw+=part;const {query,variables={}}=JSON.parse(raw||"{}");
      const list=nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
      let data={organization:{id:"linear-release",name:"Release team"},viewer:{id:"linear-ada"}};
      if(query?.includes("issueCreate(")) {const input=variables.input;if(linearIssues.has(input.id)){res.end(JSON.stringify({errors:[{message:"Duplicate id"}]}));return;}const issue={...initial,id:input.id,identifier:`ENG-${linearIssues.size+7}`,number:linearIssues.size+7,title:input.title,description:input.description??"",updatedAt:new Date().toISOString(),state:{id:input.stateId??"linear-todo",name:"Ready"},parent:input.parentId?{id:input.parentId}:null};linearIssues.set(issue.id,issue);await emit("Issue","create",issue);data={issueCreate:{success:true,issue}};}
      else if(query?.includes("issueUpdate(")) {const input=variables.input,patch={};for(const key of ["title","description"])if(input[key]!==undefined)patch[key]=input[key];if(input.stateId)patch.state={id:input.stateId,name:input.stateId};if(input.assigneeId!==undefined)patch.assignee=input.assigneeId?{id:input.assigneeId,name:input.assigneeId==="linear-ada"?"Ada":"Remy"}:null;if(input.parentId!==undefined)patch.parent=input.parentId?{id:input.parentId}:null;if(input.labelIds)patch.labels={nodes:input.labelIds.map(id=>({id,name:"Release"}))};await changeIssue(variables.id,patch,{id:"linear-app",name:"Remy"});data={issueUpdate:{success:true}};}
      else if(query?.includes("commentCreate(")) {const input=variables.input;if(linearComments.has(input.id)){res.end(JSON.stringify({errors:[{message:"Duplicate comment"}]}));return;}linearComments.set(input.id,input);await emit("Comment","create",{...input,createdAt:input.createdAt??new Date().toISOString(),user:{name:input.createAsUser??"Remy"}});data={commentCreate:{success:true}};}
      else if(query?.includes("comment(id:"))data={comment:linearComments.get(variables.id)??null};
      else if(query?.includes("issue(id:")){const issue=linearIssues.get(variables.id)??[...linearIssues.values()].find(i=>i.identifier===variables.id);if(!issue){res.end(JSON.stringify({errors:[{message:"Missing issue"}]}));return;}data={issue};}
      else if(query?.includes("issueLabels("))data={issueLabels:list([{id:"linear-label",name:"Release",team:{id:"linear-eng"}}])};
      else if(query?.includes("issues("))data={issues:list([...linearIssues.values()])};
      else if(query?.includes("workflowStates("))data={workflowStates:list([{id:"linear-todo",name:"Ready",type:"unstarted"},{id:"linear-working",name:"In progress",type:"started"},{id:"linear-done",name:"Done",type:"completed"}])};
      else if(query?.includes("projects("))data={projects:list([{id:"linear-release-plan",name:"September release",teams:{nodes:[{id:"linear-eng"}]}}])};
      else if(query?.includes("teams("))data={teams:list([{id:"linear-eng",name:"Engineering",key:"ENG"},{id:"linear-design",name:"Design",key:"DSN"}])};
      else if(query?.includes("users("))data={users:list([{id:"linear-ada",name:"Ada",email:"ada@example.test"},{id:"linear-guest",name:"Morgan",email:"morgan@example.test"},{id:"linear-agent",name:"Remy",email:"remy@example.test"}])};
      res.end(JSON.stringify({data}));return;
    }
    if(url.pathname==="/user/installations") {res.end(JSON.stringify({installations:[{id:20,app_id:12,account:{login:"release"}}]}));return;}
    if(url.pathname==="/user/installations/20/repositories") {res.end(JSON.stringify({repositories:[{id:101,full_name:"release/remy",name:"Remy",html_url:"https://github.com/release/remy"}]}));return;}
    if(url.pathname.startsWith("/repos/release/remy/")) {
      let raw="";for await(const part of req)raw+=part;const input=raw?JSON.parse(raw):{};
      if(req.method==="POST")actions.push({path:url.pathname,body:input,actor:req.headers.authorization});
      if(url.pathname.endsWith("/comments")){if(req.method==="POST"){const comment={id:comments.length+1,body:input.body};comments.push(comment);res.end(JSON.stringify(comment));}else res.end(JSON.stringify(comments));return;}
      res.end(JSON.stringify({id:7,number:7,html_url:"https://github.com/release/remy/pull/7"}));return;
    }
    if(url.pathname==="/user") {res.end(JSON.stringify({id:101,login:"ada-release"}));return;}
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,actions,comments,linearComments,linearIssues,changeIssue,bindHub:url=>{hubUrl=url;},close:()=>server.close()};
}
