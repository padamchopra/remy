import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.CODEX_HOME;
if (!home || !process.env.REMY_CODEX_TEST) throw Error('Use a disposable test home.');
const saved = join(home, 'test-account.json');
const approval = join(home, 'test-approve');
let pending = false;
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params}=JSON.parse(line);
 if(id===undefined)return;
 if(method==='initialize' && existsSync(join(home,'test-init-fail'))) { unlinkSync(join(home,'test-init-fail'));send({id,error:{message:'never-return-this-test-value'}});return; }
 let result={};
 if(method==='account/read')result={account:existsSync(saved)?JSON.parse(readFileSync(saved,'utf8')):null};
 if(method==='account/login/start'){
  if(params.type!=='chatgptDeviceCode')throw Error('Expected device auth');
  pending=true;result={type:'chatgptDeviceCode',loginId:'disposable-login',verificationUrl:'https://auth.openai.com/codex/device',userCode:'DEMO-0000'};
 }
 if(method==='account/login/cancel'){pending=false;result={status:'canceled'};}
 if(method==='account/logout'){if(existsSync(saved))unlinkSync(saved);}
 send({id,result});
});
setInterval(()=>{
 if(!pending||!existsSync(approval))return;
 const mode=readFileSync(approval,'utf8');unlinkSync(approval);pending=false;
 if(mode==='success')writeFileSync(saved,JSON.stringify({type:'chatgpt',email:'reviewer@example.test',accessToken:'never-return-this-test-value'}));
 send({method:'account/login/completed',params:{loginId:'disposable-login',success:mode==='success',error:mode==='success'?null:'never-return-this-test-value'}});
},20).unref();
