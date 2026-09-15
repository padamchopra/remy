import { Container } from "@cloudflare/containers";
import { runtimeArtifact } from "./runtime-artifact.js";
import { managementCredential } from "./cloud-connection.js";
export class ProviderContainer extends Container<{
  AUTH_SECRET: { get(): Promise<string> }; WEB_APP_URL: string;
}> {
  defaultPort = 8788;
  sleepAfter = "5m";
  async fetch(request: Request): Promise<Response> {
    const token = await managementCredential(await this.env.AUTH_SECRET.get());
    const source = new URL(`/assets/${runtimeArtifact.filename}`, this.env.WEB_APP_URL).href;
    const bootstrap = `const fs=require('node:fs');const crypto=require('node:crypto');(async()=>{const r=await fetch(${JSON.stringify(source)});if(!r.ok)throw Error('Runtime download failed');const b=Buffer.from(await r.arrayBuffer());if(crypto.createHash('sha256').update(b).digest('hex')!==${JSON.stringify(runtimeArtifact.hash)})throw Error('Runtime integrity check failed');fs.writeFileSync('/tmp/remy-provider.cjs',b);require('/tmp/remy-provider.cjs');})().catch(()=>process.exit(1));`;
    await this.startAndWaitForPorts({ startOptions: { entrypoint: ["node", "-e", bootstrap], envVars: { REMY_RUNTIME_TOKEN: token, REMY_RUNTIME_BIND: "0.0.0.0" } } });
    return this.containerFetch(request);
  }
}
