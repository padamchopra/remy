import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:[new URL('../src/lib/hub-workspace-computers.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {workspaceComputers}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
test('workspace computers match repository copies across clone URL formats, including offline and hosted copies',()=>{
 const computer=(id,origin,ownership='personal',availability='online')=>({computerId:id,ownership,availability,capabilities:{workspaces:[{origin}]}});
 const computers=[computer('mac','git@github.com:example/repo.git'),computer('cloud','https://github.com/example/repo','hosted'),computer('offline','ssh://git@github.com/example/repo.git','personal','offline'),computer('other','https://github.com/example/other'),computer('unknown',null)];
 assert.deepEqual(workspaceComputers('github.com/example/repo',computers).map(c=>c.computerId),['mac','cloud','offline']);
 assert.deepEqual(workspaceComputers('github.com/missing/repo',computers),[]);
});
