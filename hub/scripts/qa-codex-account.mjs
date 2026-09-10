import {spawn} from "node:child_process";
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function startHostedCodexFixture(temp, root) {
  const home = join(temp, 'codex');
  const bin = join(temp, 'bin');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env node\n' + readFileSync(join(root, 'server/test/fixtures/codex-account.mjs'), 'utf8'), {mode:0o700});
  process.env.CODEX_HOME = home;
  process.env.REMY_CODEX_TEST = '1';
  process.env.PATH = `${bin}:${process.env.PATH}`;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let connection, hubUrl;
  const tasks=new Map();
  const server = createServer(async (req,res) => {
    if(req.headers.authorization !== 'Bearer disposable-runtime-credential-for-failure-check'){res.writeHead(401).end();return;}
    try {
      let raw='';for await(const part of req)raw+=part;
      const body=JSON.parse(raw);
      const input=req.url.endsWith('/provision')?body:body.input;
      if (input) {
        const bootstrap=JSON.parse(input.environment.REMY_HOSTED_BOOTSTRAP);
        if(bootstrap.taskId) {
          let child=tasks.get(input.computerId);
          if(!child || child.exitCode!==null || child.killed) {
            const taskHome=join(temp,'task-'+input.computerId);
            const env={...process.env,...input.environment,MC_CONFIG_DIR:taskHome,QA_TASK_INPUT:JSON.stringify(input),QA_TASK_HUB:hubUrl};
            delete env.CODEX_HOME;delete env.CLAUDE_CONFIG_DIR;
            child=spawn(process.execPath,['--import',join(root,'hub/node_modules/tsx/dist/loader.mjs'),join(root,'hub/scripts/qa-task-computer.mjs')],{env,stdio:['ignore','ignore','inherit']});tasks.set(input.computerId,child);
          }
          res.setHeader('content-type','application/json');res.end(JSON.stringify({id:input.computerId,provider:input.settings.provider,providerReference:input.computerId,startedAt:Date.now()}));return;
        }
        const {setKv}=await import('../../server/dist/db.js');
        setKv('hostedWorkspaceId',bootstrap.workspace.id);
        for (const name of ['ANTHROPIC_API_KEY','OPENAI_API_KEY']) { if(input.environment[name])process.env[name]=input.environment[name];else delete process.env[name]; }
        setKv('hubComputerPrivateKey',bootstrap.privateKey);
        const {configureHostedCodex}=await import('../../server/dist/hosted-codex-account.js');
        configureHostedCodex(home,false);
        const {HubComputerConnection}=await import('../../server/dist/hub-computer.js');
        connection?.stop();
        connection=new HubComputerConnection({...bootstrap.registration,hubUrl},async()=>bootstrap.registration.capabilities);
        connection.start();
        res.setHeader('content-type','application/json');res.end(JSON.stringify({id:input.computerId,provider:input.settings.provider,providerReference:'disposable-runtime',startedAt:Date.now()}));
      } else { if(tasks.has(body.runtime?.id)) {if(req.url.endsWith('/stop')||req.url.endsWith('/destroy'))tasks.get(body.runtime.id).kill();res.setHeader('content-type','application/json');res.end(JSON.stringify({...body.runtime,...(req.url.endsWith('/checkpoint')?{snapshot:'disposable-task-snapshot'}:{})}));return;} if(req.url.endsWith('/destroy')) { connection?.stop(); const {closeHostedCodexAccount}=await import('../../server/dist/hosted-codex-account.js'); closeHostedCodexAccount(); } res.setHeader('content-type','application/json');res.end(JSON.stringify(body.runtime)); }
    } catch(error) {console.error("Disposable runtime failure",error);res.writeHead(500).end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {
    url:`http://127.0.0.1:${server.address().port}`,
    setHubUrl(value){hubUrl=value;},
    approve(success=true){writeFileSync(join(home,'test-approve'),success?'success':'failure');},
    disconnect(){connection?.stop();},
    reconnect(){connection?.start();},
    async restartAccount(){const {closeHostedCodexAccount}=await import('../../server/dist/hosted-codex-account.js');closeHostedCodexAccount();},
    close(){for(const child of tasks.values())child.kill();connection?.stop();server.close();},
  };
}
