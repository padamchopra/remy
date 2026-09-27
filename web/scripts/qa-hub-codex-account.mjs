import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromiumPath} from './chromium.mjs';
// Run against `QA_CHATGPT=1 QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs`.
// The hub signs in against a fake OpenAI auth server (hub/scripts/fake-openai-auth.mjs), and task
// computers run a Codex stand-in that reports which ChatGPT account the hub served. No real
// ChatGPT account or OpenAI endpoint is involved.
const info=JSON.parse(readFileSync(process.env.QA_SESSION,'utf8'));
const out=process.env.QA_ARTIFACTS;mkdirSync(out,{recursive:true});
const base=`${info.hubUrl}/api/organizations/${info.organizationId}`;
const request=async(user,url,method='GET',body)=>{const r=await fetch(url,{method,headers:{authorization:`Bearer ${info.tokens[user]}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();return{status:r.status,text,body:text?JSON.parse(text):null};};
const call=(user,path,method,body)=>request(user,base+path,method,body);
const account=(user,action='',method=action?'POST':'GET')=>request(user,`${info.hubUrl}/api/chatgpt-account${action?'/'+action:''}`,method);
const control=async(path)=>{const response=await fetch(info.controlUrl+path,{method:'POST',headers:{authorization:`Bearer ${info.controlToken}`}});assert.ok(response.ok,path);return response;};
const until=async(condition,label)=>{for(let i=0;i<300;i++){if(await condition())return;await new Promise(r=>setTimeout(r,100));}throw Error(`${label} did not happen`);};
const personal=(await request('ada',`${info.hubUrl}/api/personal`)).body.personal.id;
const workspace=(await call('ada','/workspaces','POST',{name:'Website',origin:'https://example.test/studio/website.git'})).body;
const provider=process.env.QA_PROVIDER??'modal';

// Claude Code account login never runs on a cloud computer.
assert.equal((await call('ada','/claude-account/start','POST')).status,403);
assert.match((await call('ada','/claude-account/start','POST')).body.error,/computer you own/);
// ChatGPT belongs to each person, never to a workspace's computer.
assert.notEqual((await call('ada',`/hosted/${workspace.id}/codex/start`,'POST')).status,200);
assert.deepEqual((await account('ada')).body,{phase:'signedOut'});
assert.equal((await account('computer-owner','start')).status,403,'a computer cannot start anyone’s ChatGPT sign-in');
assert.notEqual((await account('ada','tokens')).status,200,'no browser route serves tokens');
assert.ok([401,403].includes((await call('ada','/computers/codex-tokens','POST')).status),'only a signed task computer asks for tokens');

assert.equal((await call('ada','/cloud-connection','PUT',provider==='modal'?{provider,enabled:true,tokenId:'disposable-token-id',tokenSecret:'disposable-token-secret'}:{provider,enabled:true,token:'disposable-token'})).status,200);
assert.equal((await call('ada',`/hosted/${workspace.id}/settings`,'PUT',{settings:{enabled:true,provider}})).status,200);

const browser=await chromium.launch({executablePath:chromiumPath()});
const ctx=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:'dark',recordVideo:{dir:out,size:{width:1280,height:1000}}});
await ctx.addCookies([{name:'remy_session',value:info.tokens.ada,url:info.hubUrl,httpOnly:true,sameSite:'Lax'}]);
await ctx.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{
 const pointer=document.createElement('div');pointer.style.cssText='position:fixed;width:14px;height:14px;border:2px solid white;border-radius:50%;background:#222;pointer-events:none;z-index:2147483647;left:20px;top:20px';document.body.append(pointer);
 document.addEventListener('pointermove',e=>{pointer.style.left=`${e.clientX-7}px`;pointer.style.top=`${e.clientY-7}px`;});
 document.addEventListener('pointerdown',()=>{pointer.animate([{boxShadow:'0 0 0 0 #f5c451',background:'#f5c451'},{boxShadow:'0 0 0 18px transparent',background:'#222'}],{duration:650});},true);
});});
const p=await ctx.newPage();
const click=async locator=>{await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:20});await p.waitForTimeout(400);await locator.click();await p.waitForTimeout(1000);};
const threads=[];
const startThread=async(user,title)=>{
 const requestId=crypto.randomUUID();
 let response=await call(user,'/threads','POST',{workspaceId:workspace.id,title,requestId,provider:'codex',model:'gpt-5.6-sol',computerId:`cloud:${provider}`,visibility:'open'});
 for(let n=0;n<600 && response.status<400 && !response.body?.id;n++){await new Promise(r=>setTimeout(r,100));response=await call(user,`/threads/starts/${requestId}`);}
 return response;
};
const reply=async(user,thread,text)=>{
 const path=`/computers/${thread.computerId}/threads/${thread.id}`;
 const before=((await call(user,path)).body?.detail?.entries??[]).length;
 const sent=await call(user,path+'/message','POST',{text,messageId:'u-'+crypto.randomUUID()});
 assert.equal(sent.status,200,sent.text);
 let answer;
 await until(async()=>{const entries=(await call(user,path)).body?.detail?.entries??[];answer=entries.slice(before).filter(e=>e.kind==='assistant').at(-1)?.text;return !!answer;},`${user}'s reply`);
 return answer;
};
try {
 // Sign in once, in Personal → Computers → Cloud → Model access: no workspace, no computer to start.
 await p.goto(`${info.hubUrl}/app/#/settings/devices?organization=${personal}&device=cloud`);
 const codex=p.getByRole('region',{name:'Codex model access',exact:true});
 await codex.waitFor();
 assert.equal(await codex.getByRole('combobox').count(),0);
 assert.equal(await codex.getByRole('button',{name:'Start computer',exact:true}).count(),0);
 await click(codex.getByRole('button',{name:'Connect Codex',exact:true}));
 assert.equal(await p.getByLabel('Codex sign-in code',{exact:true}).inputValue(),'DEMO-0000');
 assert.match(await p.getByRole('link',{name:'Open sign-in page'}).getAttribute('href'),/\/codex\/device$/);
 await p.waitForTimeout(1200);await p.screenshot({path:out+'/device-code.png'});
 await click(p.getByRole('button',{name:'Cancel sign-in',exact:true}));
 await codex.getByRole('button',{name:'Connect Codex',exact:true}).waitFor();
 await click(codex.getByRole('button',{name:'Connect Codex',exact:true}));
 await control('/chatgpt-approve?email=ada%40chatgpt.test&account=acct-ada');
 await p.getByText('Connected as ada@chatgpt.test.',{exact:true}).waitFor({timeout:15000});
 await p.waitForTimeout(1200);await p.screenshot({path:out+'/connected.png'});
 const status=await account('ada');
 assert.deepEqual(status.body,{phase:'connected',email:'ada@chatgpt.test'});
 assert.ok(!status.text.includes('fake-refresh') && !status.text.includes('acct-ada'),'the browser never sees tokens');
 // An organization's Model access has no ChatGPT sign-in of its own.
 await p.goto(`${info.hubUrl}/app/#/settings/devices?organization=${info.organizationId}&device=cloud`);
 await p.getByRole('region',{name:'Model access',exact:true}).waitFor();
 assert.equal(await p.getByRole('region',{name:'Codex model access',exact:true}).count(),0);

 // Grace, a member, signs in with her own ChatGPT.
 assert.deepEqual((await call('grace','/chatgpt')).body,{connected:false,enabled:true,personal:false,available:false});
 assert.equal((await startThread('grace','Before signing in')).status,409,'nobody else’s sign-in runs a member’s thread');
 assert.equal((await account('grace','start')).body.phase,'pending');
 await control('/chatgpt-approve?email=grace%40chatgpt.test&account=acct-grace');
 await until(async()=>(await account('grace')).body.phase==='connected','Grace’s sign-in');

 // The org toggle lives with the person, in Organization → Computers.
 await p.goto(`${info.hubUrl}/app/#/settings/organization?section=computers&organization=${info.organizationId}`);
 const toggle=p.getByRole('switch',{name:'Use my ChatGPT plan here',exact:true});
 await toggle.waitFor();
 assert.equal(await toggle.getAttribute('aria-checked'),'true','a Personal sign-in is available in each organization until you turn it off');
 await p.waitForTimeout(800);await p.screenshot({path:out+'/organization-toggle.png'});

 const ada=await startThread('ada','Ada on ChatGPT');
 assert.ok(ada.status<300 && ada.body?.id,ada.text);threads.push(ada.body);
 const grace=await startThread('grace','Grace on ChatGPT');
 assert.ok(grace.status<300 && grace.body?.id,grace.text);threads.push(grace.body);
 assert.equal(await reply('ada',ada.body,'Which account?'),'ChatGPT account acct-ada.');
 assert.equal(await reply('grace',grace.body,'Which account?'),'ChatGPT account acct-grace.','a member’s task gets only their own tokens');
 const joined=await call('grace',`/computers/${ada.body.computerId}/threads/${ada.body.id}/join`,'POST');
 assert.ok(joined.status<300,joined.text);
 assert.equal(await reply('grace',ada.body,'Replying in Ada’s thread.'),'ChatGPT account acct-ada.','a thread keeps its starter’s sign-in, whoever replies');

 // Grace turns hers off here: her running thread fails its next refresh, and her new ones cannot start on it.
 assert.equal((await call('grace','/chatgpt','DELETE')).body.enabled,false);
 assert.match(await reply('grace',grace.body,'Again?'),/reconnect/i);
 assert.equal((await startThread('grace','After turning it off')).status,409);
 assert.equal(await reply('ada',ada.body,'Still yours?'),'ChatGPT account acct-ada.','the toggle is per person');

 // Ada signs out: the stored tokens are removed and her thread asks her to reconnect.
 await p.goto(`${info.hubUrl}/app/#/settings/devices?organization=${personal}&device=cloud`);
 await click(p.getByRole('button',{name:'Disconnect Codex',exact:true}));
 await p.getByRole('button',{name:'Connect Codex',exact:true}).waitFor();
 assert.match(await reply('ada',ada.body,'After signing out?'),/reconnect/i);
 await ctx.close();console.log(`VIDEO=${await p.video().path()}`);

 const narrow=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'});
 await narrow.addCookies([{name:'remy_session',value:info.tokens.grace,url:info.hubUrl,httpOnly:true,sameSite:'Lax'}]);
 const mobile=await narrow.newPage();
 const gracePersonal=(await request('grace',`${info.hubUrl}/api/personal`)).body.personal.id;
 await mobile.goto(`${info.hubUrl}/app/#/settings/devices?organization=${gracePersonal}&device=cloud`);
 await mobile.getByText('Connected as grace@chatgpt.test.',{exact:true}).waitFor();
 assert.ok(await mobile.locator('main').first().evaluate(e=>e.scrollWidth<=e.clientWidth));
 await mobile.getByRole('region',{name:'Codex model access',exact:true}).scrollIntoViewIfNeeded();
 await mobile.screenshot({path:out+'/mobile-codex.png'});
 await narrow.close();
 console.log('PASS: ChatGPT sign-in held by the hub against a fake OpenAI auth server; own-account tokens per starter, starter kept on replies, per-organization toggle, sign-out, Claude Code refused, and mobile layout');
} catch(error){if(!p.isClosed())await p.screenshot({path:out+'/failure.png'});throw error;}
finally {
 await browser.close();
 for(const user of ['ada','grace'])await account(user,'logout');
 await call('grace','/chatgpt','PUT');
 await call('ada',`/workspaces/${workspace.id}`,'DELETE');
 await call('ada','/cloud-connection','PATCH',{provider,enabled:false});
}
