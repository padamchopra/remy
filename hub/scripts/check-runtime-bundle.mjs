import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const manifest=await readFile(new URL('../src/runtime-artifact.ts',import.meta.url),'utf8');
const filename=JSON.parse(manifest.match(/= (.*);/)[1]).filename;
const portServer=createServer(); await new Promise(r=>portServer.listen(0,'127.0.0.1',r)); const port=portServer.address().port; await new Promise(r=>portServer.close(r));
const token=randomBytes(32).toString('hex');
const child=spawn(process.execPath,[new URL('../../web/dist/app/assets/'+filename,import.meta.url).pathname],{env:{...process.env,REMY_RUNTIME_TOKEN:token,PORT:String(port),REMY_RUNTIME_BIND:'127.0.0.1'},stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',b=>errors+=b);
try {
  let response;
  for(let n=0;n<50;n++){try{response=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:`Bearer ${token}`}});break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(response,errors.slice(-2200)); assert.equal(response.status,200); assert.deepEqual(await response.json(),{status:'ready'});
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,401);
  console.log('Bundled runtime boots and requires management authentication.');
} finally {child.kill('SIGTERM');}
