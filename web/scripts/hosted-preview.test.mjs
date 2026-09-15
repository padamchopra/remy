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
   await call('/api/sessions/current','DELETE');
   assert.equal((await call('/api/profile')).status,401);
  } finally {await actual.close();}
 } finally {await new Promise(resolve=>upstream.close(resolve));}
});
