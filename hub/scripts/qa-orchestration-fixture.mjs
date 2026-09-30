import { randomUUID } from "node:crypto";
export async function fixtureOrchestrationTurn({ inProcessMcp, event }) {
  const {Client}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
  const {InMemoryTransport}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js");
  const {applyToolOutput}=await import("../../server/dist/transcript.js");
  const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:"Delegation QA",version:"1"});
  await inProcessMcp.instance.connect(serverSide);await client.connect(clientSide);
  const call=async(name,args={})=>{
    const result=await client.callTool({name,arguments:args});const text=result.content?.[0]?.text??"";
    const entry={id:randomUUID(),kind:"tool",tool:name};applyToolOutput(entry,text,10000);event({type:"entry.updated",entry});
    if(result.isError)throw Error(text);try{return JSON.parse(text.split("\n<remy-artifact>")[0]);}catch{return text;}
  };
  try {
    const tools=await client.listTools();
    for(const name of ["start_thread","list_threads","read_thread","send_to_thread"])if(!tools.tools.some(t=>t.name===name))throw Error(`${name} unavailable`);
    await call("list_threads");
    const request_id=randomUUID();
    const child=await call("start_thread",{prompt:"QA delegated work: inspect without changing files",title:"Delegated inspection",request_id});
    const retry=await call("start_thread",{prompt:"QA delegated work: inspect without changing files",title:"Delegated inspection",request_id});
    if(retry.id!==child.id)throw Error("Retry created another thread");
    await call("read_thread",{thread_id:child.id});
    const message_id=randomUUID();
    await call("send_to_thread",{thread_id:child.id,message:"QA agent follow-up",message_id});
    await call("send_to_thread",{thread_id:child.id,message:"QA agent follow-up",message_id});
    return `Delegation complete: ${child.id}`;
  } finally {await client.close();}
}
