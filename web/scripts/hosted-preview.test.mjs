import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
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

