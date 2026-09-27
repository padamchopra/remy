import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export async function startConnectionProvider() {
  const codes=new Map(), comments=[], actions=[];
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
      for await(const _part of req);
      const data={organization:{id:"linear-release",name:"Release team"},viewer:{id:"linear-ada"}};
      res.end(JSON.stringify({data}));return;
    }
    if(url.pathname==="/user/installations") {res.end(JSON.stringify({installations:[{id:20,app_id:12,account:{login:"release"}}]}));return;}
    if(url.pathname==="/user/installations/20/repositories") {res.end(JSON.stringify({repositories:[{id:101,full_name:"release/remy",name:"Remy",html_url:"https://github.com/release/remy"}]}));return;}
    if(url.pathname==="/user/repos") {const day=ms=>new Date(Date.now()-ms).toISOString();res.end(JSON.stringify([
      {id:101,name:"Remy",full_name:"release/remy",html_url:"https://github.com/release/remy",description:"A remote for coding agents on your own machines.",language:"TypeScript",private:true,pushed_at:day(120000)},
      {id:102,name:"Phere",full_name:"release/phere",html_url:"https://github.com/release/phere",description:"Presence for the people you actually know.",language:"Swift",private:true,pushed_at:day(259200000)},
      {id:103,name:"emulator-cloud",full_name:"release/emulator-cloud",html_url:"https://github.com/release/emulator-cloud",description:"Android emulators, on demand, on someone else's hardware.",language:"Go",private:false,pushed_at:day(604800000)},
      {id:104,name:"stay-awake",full_name:"release/stay-awake",html_url:"https://github.com/release/stay-awake",description:null,language:null,private:false,pushed_at:day(2592000000)},
      {id:201,name:"planet-mobile",full_name:"orbit/planet-mobile",html_url:"https://github.com/orbit/planet-mobile",description:"The Android and iOS clients.",language:"Kotlin",private:true,pushed_at:day(14400000)},
      {id:202,name:"chainkit",full_name:"orbit/chainkit",html_url:"https://github.com/orbit/chainkit",description:"One Rust core, bound into every client.",language:"Rust",private:true,pushed_at:day(86400000)}]));return;}
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
  return {url:`http://127.0.0.1:${server.address().port}`,actions,comments,close:()=>server.close()};
}
