import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export async function startConnectionProvider() {
  const codes=new Map();
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
    if(url.pathname==="/graphql") {res.end(JSON.stringify({data:{organization:{id:"linear-release",name:"Release team"},viewer:{id:"linear-ada"}}}));return;}
    if(url.pathname==="/user") {res.end(JSON.stringify({id:101,login:"ada-release"}));return;}
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>server.close()};
}
