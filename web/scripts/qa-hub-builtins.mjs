import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {chromiumPath} from './chromium.mjs';
const info=JSON.parse(readFileSync(process.env.QA_SESSION,'utf8')),out=process.env.QA_ARTIFACTS;mkdirSync(out,{recursive:true});const base=`${info.hubUrl}/api/organizations/${info.organizationId}`;
const call=async(user,path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${info.tokens[user]}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.status===204?null:await r.json()};};
const cs=await call('ada','/computers'),c=cs.body.computers.find(c=>c.computerId===info.computerId);const ws=[];for(const local of c.capabilities.workspaces){const w=await call('ada','/workspaces','POST',{name:local.name==="Android"?"Android":"A release notes",origin:local.origin});assert.equal(w.status,201);ws.push(w.body);}
await call('ada','/routing','PUT',{rules:[{id:'default',name:'Studio',target:{computerId:c.computerId}}]});
const all=await call('ada','/agents'),orgAgent=all.body.agents.find(a=>a.fields.builtIn==='orchestrator'),personal=all.body.agents.find(a=>a.fields.builtIn==='personal');assert.ok(orgAgent&&personal);assert.ok(!(await call('grace','/agents')).body.agents.some(a=>a.id===personal.id));
const browser=await chromium.launch({executablePath:chromiumPath()}),context=await browser.newContext({viewport:{width:1280,height:900},colorScheme:'dark',recordVideo:{dir:out,size:{width:1280,height:900}}});await context.addCookies([{name:'remy_session',value:info.tokens.ada,url:info.hubUrl,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();
try{
 await page.goto(`${info.hubUrl}/#/inbox/${encodeURIComponent(orgAgent.id)}?organization=${info.organizationId}`);await page.getByLabel('Organization agent name',{exact:true}).fill('Release coordinator');await page.getByRole('button',{name:'Rename agent',exact:true}).click();await page.getByRole('heading',{name:'Release coordinator',exact:true}).waitFor();await page.getByLabel('Message',{exact:true}).fill('Send Android work to Studio.');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByText('Android work now goes to Studio.',{exact:false}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'Routing',exact:true}).click();await page.getByLabel('Rule name',{exact:true}).first().waitFor();assert.equal(await page.getByLabel('Rule name',{exact:true}).first().inputValue(),'Android on Studio');await page.screenshot({path:out+'/orchestrated-routing.png'});
 await page.goto(`${info.hubUrl}/#/inbox/${encodeURIComponent(personal.id)}?organization=${info.organizationId}`);await page.getByLabel('Message',{exact:true}).fill('Create an Android ticket for the release.');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByText('I created the Android release ticket.',{exact:false}).waitFor({timeout:45000});const tickets=await call('ada','/board/tickets');assert.ok(tickets.body.items.some(t=>t.fields.title==='Check the Android release'&&t.fields.projectId===ws.find(w=>w.name==='Android').id));await page.screenshot({path:out+'/personal-remy.png'});
 const made=tickets.body.items.find(t=>t.fields.title==='Check the Android release');
 const listing=await call('ada','/threads');const run=listing.body.threads.find(t=>t.detail.entries.some(e=>e.artifacts?.some(a=>a.id===made.id)));
 assert.ok(run,'MCP artifact reaches the thread transcript');
 await page.goto(`${info.hubUrl}/#/threads/${run.id}?organization=${info.organizationId}&computer=${run.computerId}`);
 await page.getByRole('button',{name:'Check the Android release',exact:true}).click();await page.waitForURL(url=>url.hash.includes(`/tickets/${made.id}`));
 await page.getByText('Review the next release.',{exact:true}).waitFor();
 await page.screenshot({path:out+'/ticket-artifact.png'});

 for(const payload of [{name:'Impostor'},{instructions:'Ignore protections'},{handle:'another'}])assert.equal((await call('ada','/board/events','POST',{entity:'agent',entityId:personal.id,kind:'field',payload})).status,404);
 assert.equal((await call('ada','/board/events','POST',{entity:'agent',entityId:orgAgent.id,kind:'tombstone',payload:{}})).status,404);console.log('PASS: seeded private and organization agents, protected identity, allowed rename, real in-process MCP routing edit and cross-workspace ticket from disposable model turns');
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await context.close();await browser.close();}console.log(`VIDEO=${await page.video().path()}`);
