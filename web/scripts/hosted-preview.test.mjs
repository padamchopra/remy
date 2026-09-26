import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { createServer as vite } from 'vite';
import { hostedPreview } from '../hosted-preview.ts';
test('preview approval keeps credentials on the proxy and rejects foreign origins', async () => {
 const requests=[];
 const upstream=createServer(async(req,res)=>{
  let raw=''; for await (const data of req) raw+=data;
  requests.push({path:req.url,headers:req.headers,body:raw});
  if(req.url==='/api/unavailable') { req.socket.destroy(); return; }
  res.setHeader('content-type','application/json');
  if(req.url==='/api/device/authorization') res.end(JSON.stringify({deviceCode:'private-code',userCode:'ABCD-EFGH'}));
  else if(req.url==='/api/device/token') res.end(JSON.stringify({status:'approved',accessToken:'private-access',refreshToken:'private-refresh',expiresIn:3600}));
  else res.end(JSON.stringify({ok:true}));
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 try {
  const p=hostedPreview(`http://127.0.0.1:${upstream.address().port}`);
  const actual=await vite({configFile:false,plugins:[p.plugin],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':p.proxy}}});
  await actual.listen();
  try {
   const call=(path,method='GET',source=origin)=>fetch(origin+path,{method,headers:{origin:source}});
   const redirect=await new Promise((resolve,reject)=>request({host:'127.0.0.1',port,path:'/threads/abc',headers:{host:`localhost:${port}`}},resolve).on('error',reject).end());
   redirect.resume();
   assert.equal(redirect.statusCode,307);
   assert.equal(redirect.headers.location,`${origin}/threads/abc`);
   assert.equal((await call('/api/profile')).status,401);
   assert.equal((await call('/api/preview/sign-in','POST','https://evil.test')).status,403);
   const start=await (await call('/api/preview/sign-in','POST')).text();
   assert.ok(start.includes('ABCD-EFGH'));assert.ok(!start.includes('private-code'));
   const finish=await (await call('/api/preview/complete','POST')).text();
   assert.deepEqual(JSON.parse(finish),{status:'approved'});
   assert.ok(!finish.includes('private-'));
   await call('/api/organizations/team/threads','POST');
   const forwarded=requests.at(-1);
   assert.equal(forwarded.headers.authorization,'Bearer private-access');
   assert.equal(forwarded.headers.origin,origin);
   assert.equal((await call('/api/profile','GET','https://evil.test')).status,403);
   const failed=await call('/api/unavailable');
   assert.equal(failed.status,502);
   assert.deepEqual(await failed.json(),{error:'Could not connect to Remy; try again.'});
   await call('/api/sessions/current','DELETE');
   assert.equal((await call('/api/profile')).status,401);
  } finally {await actual.close();}
 } finally {await new Promise(resolve=>upstream.close(resolve));}
});

test('preview password sign-in uses environment secrets and keeps them off the page', async () => {
 const previousEmail=process.env.REMY_QA_EMAIL, previousPassword=process.env.REMY_QA_PASSWORD;
 process.env.REMY_QA_EMAIL='qa@example.test';
 process.env.REMY_QA_PASSWORD='qa-test-password';
 const requests=[];
 const upstream=createServer(async(req,res)=>{
  let raw=''; for await (const data of req) raw+=data;
  requests.push({path:req.url,headers:req.headers,body:raw});
  res.setHeader('content-type','application/json');
  if(req.url==='/api/auth/sign-in/email') {
   res.setHeader('set-cookie','better-auth.session_token=auth-cookie; HttpOnly');
   res.end(JSON.stringify({user:{email:'qa@example.test'}}));
  } else if(req.url==='/api/sessions/web') {
   res.setHeader('set-cookie','remy_session=preview-token; HttpOnly; Path=/');
   res.end(JSON.stringify({expiresIn:604800}));
  } else res.end(JSON.stringify({ok:true}));
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 try {
  const p=hostedPreview(`http://127.0.0.1:${upstream.address().port}`);
  const actual=await vite({configFile:false,plugins:[p.plugin],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':p.proxy}}});
  await actual.listen();
  try {
   const call=(path,method='GET')=>fetch(origin+path,{method,headers:{origin}});
   const runtime=await (await call('/api/runtime')).json();
   assert.equal(runtime.auth.password,true);
   const signed=await call('/api/preview/password','POST');
   const body=await signed.text();
   assert.equal(signed.status,200);
   assert.deepEqual(JSON.parse(body),{status:'approved'});
   assert.equal(body.includes('qa-test-password'),false);
   assert.equal(body.includes('preview-token'),false);
   assert.equal(JSON.parse(requests[0].body).password,'qa-test-password');
   assert.equal(requests[1].headers.cookie,'better-auth.session_token=auth-cookie');
   await call('/api/organizations/team/threads','POST');
   assert.equal(requests.at(-1).headers.authorization,'Bearer preview-token');
  } finally {await actual.close();}
 } finally {
  await new Promise(resolve=>upstream.close(resolve));
  if(previousEmail===undefined) delete process.env.REMY_QA_EMAIL; else process.env.REMY_QA_EMAIL=previousEmail;
  if(previousPassword===undefined) delete process.env.REMY_QA_PASSWORD; else process.env.REMY_QA_PASSWORD=previousPassword;
 }
});

test('preview stays signed in across access-token expiry until the hub rejects the refresh token', async () => {
 // An access token that lasts just past the refresh margin, so a refresh is
 // due at once and each answer from the hub can be chosen.
 const lifetime=60.4;
 let mode='ok', issued=1, refreshToken='refresh-1';
 const refreshes=[], forwarded=[], upgrades=[];
 const upstream=createServer(async(req,res)=>{
  let raw=''; for await (const data of req) raw+=data;
  res.setHeader('content-type','application/json');
  if(req.url==='/api/device/authorization') return res.end(JSON.stringify({deviceCode:'code',userCode:'ABCD-EFGH'}));
  if(req.url==='/api/device/token') return res.end(JSON.stringify({status:'approved',accessToken:'access-1',refreshToken,expiresIn:lifetime}));
  if(req.url==='/api/sessions/refresh') {
   const sent=JSON.parse(raw).refreshToken;
   refreshes.push(sent);
   if(mode==='unavailable') { res.writeHead(503); return res.end(JSON.stringify({error:'Unavailable'})); }
   if(mode==='reject'||sent!==refreshToken) { res.writeHead(401); return res.end(JSON.stringify({error:'Sign in again.'})); }
   issued+=1; refreshToken=`refresh-${issued}`;
   return res.end(JSON.stringify({tokenType:'Bearer',accessToken:`access-${issued}`,refreshToken,expiresIn:lifetime}));
  }
  forwarded.push(req.headers.authorization);
  res.end(JSON.stringify({ok:true}));
 });
 upstream.on('upgrade',(req,socket)=>{
  upgrades.push(req.headers.authorization);
  socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const upgrade=()=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:'/api/organizations/team/live',headers:{origin,connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ=='}});
  req.on('upgrade',(_res,socket)=>{socket.destroy();resolve();});
  req.on('response',res=>{res.resume();resolve();});
  req.on('error',reject);
  req.end();
 });
 try {
  const p=hostedPreview(`http://127.0.0.1:${upstream.address().port}`);
  const actual=await vite({configFile:false,plugins:[p.plugin],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':p.proxy}}});
  await actual.listen();
  try {
   const call=(path,method='GET')=>fetch(origin+path,{method,headers:{origin}});
   await call('/api/preview/sign-in','POST');
   assert.deepEqual(await (await call('/api/preview/complete','POST')).json(),{status:'approved'});

   // Refreshed on its own, without a request from the page: live sockets carry
   // no requests, and the hub closes them once the session's access lapses.
   await wait(800);
   assert.deepEqual(refreshes,['refresh-1']);
   assert.equal((await call('/api/profile')).status,200);
   assert.equal(forwarded.at(-1),`Bearer access-${issued}`);

   // A hub that cannot answer keeps the session and its current token.
   mode='unavailable';
   await wait(600);
   const kept=issued, attempts=refreshes.length;
   assert.equal((await call('/api/profile')).status,200);
   assert.ok(refreshes.length>attempts);
   assert.equal(forwarded.at(-1),`Bearer access-${kept}`);

   // A websocket upgrade waits for the due refresh rather than carrying a stale token.
   mode='ok';
   await upgrade();
   assert.ok(issued>kept);
   assert.equal(upgrades.at(-1),`Bearer access-${issued}`);

   // Only a refresh token the hub rejects ends the session.
   mode='reject';
   await wait(600);
   assert.equal((await call('/api/profile')).status,401);
   mode='ok';
   assert.equal((await call('/api/profile')).status,401);
  } finally {await actual.close();}
 } finally {await new Promise(resolve=>upstream.close(resolve));}
});

test('preview password sign-in fails clearly when secrets are missing', async () => {
 const previousEmail=process.env.REMY_QA_EMAIL, previousPassword=process.env.REMY_QA_PASSWORD;
 delete process.env.REMY_QA_EMAIL;
 delete process.env.REMY_QA_PASSWORD;
 const upstream=createServer((_req,res)=>{res.writeHead(500);res.end();});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 try {
  const p=hostedPreview(`http://127.0.0.1:${upstream.address().port}`);
  const actual=await vite({configFile:false,plugins:[p.plugin],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':p.proxy}}});
  await actual.listen();
  try {
   const call=(path,method='GET')=>fetch(origin+path,{method,headers:{origin}});
   const runtime=await (await call('/api/runtime')).json();
   assert.equal(runtime.auth.password,false);
   const failed=await call('/api/preview/password','POST');
   assert.equal(failed.status,400);
   assert.deepEqual(await failed.json(),{error:'set REMY_QA_EMAIL and REMY_QA_PASSWORD'});
  } finally {await actual.close();}
 } finally {
  await new Promise(resolve=>upstream.close(resolve));
  if(previousEmail===undefined) delete process.env.REMY_QA_EMAIL; else process.env.REMY_QA_EMAIL=previousEmail;
  if(previousPassword===undefined) delete process.env.REMY_QA_PASSWORD; else process.env.REMY_QA_PASSWORD=previousPassword;
 }
});

