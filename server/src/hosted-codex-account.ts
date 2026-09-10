import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodexAccount } from "./codex-account.js";
import { agentCommand } from "./agent.js";
import { getKv, setKv } from "./db.js";

export function configureHostedCodex(home: string, connected: boolean) {
  process.env.REMY_HOSTED_CODEX_PROVIDER = connected ? "openai" : "remy_openai";
  writeFileSync(
    join(home, "config.toml"),
    connected
      ? 'model_provider = "openai"\ncli_auth_credentials_store = "file"\n'
      : 'model_provider = "remy_openai"\ncli_auth_credentials_store = "file"\n[model_providers.remy_openai]\nname = "OpenAI"\nbase_url = "https://api.openai.com/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\nrequires_openai_auth = false\n',
    { mode: 0o600 },
  );
}

let account: CodexAccount | undefined;
export async function hostedCodexAccountRequest(
  method: string,
  path: string,
  changed: () => void,
): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!getKv("hostedWorkspaceId") || !process.env.CODEX_HOME)
    return Response.json(
      { error: "Choose a hosted computer." },
      { status: 403, headers },
    );
  const action =
    path === "/hub/codex-account" && method === "GET"
      ? "status"
      : method === "POST" && path === "/hub/codex-account/start"
        ? "start"
        : method === "POST" && path === "/hub/codex-account/cancel"
          ? "cancel"
          : method === "POST" && path === "/hub/codex-account/logout"
            ? "logout"
            : undefined;
  if (!action)
    return Response.json(
      { error: "This account action is unavailable." },
      { status: 404, headers },
    );
  try {
    if (!account)
      account = new CodexAccount({
        command: agentCommand("codex")!,
        cwd: process.env.CODEX_HOME,
        env: { ...process.env },
        changed,
        connected: async (connected) => {
          if (getKv<boolean>("hostedCodexConnected") === connected) return;
          configureHostedCodex(process.env.CODEX_HOME!, connected);
          setKv("hostedCodexConnected", connected);
          const { refreshProviderSessions } = await import("./chat.js");
          refreshProviderSessions("codex");
        },
      });
    return Response.json(
      action === "status"
        ? await account.status()
        : await account.change(action),
      { headers },
    );
  } catch {
    return Response.json(
      {
        error:
          "Codex could not connect; enable device code login in ChatGPT settings and try again.",
      },
      { status: 502, headers },
    );
  }
}
export function closeHostedCodexAccount() {
  account?.close();
  account = undefined;
}

let tokenRequest:Promise<Response>|undefined;
/// Only the authenticated computer relay calls this; refresh credentials stay here.
export async function hostedCodexTokens(changed:()=>void):Promise<Response> {
  if(tokenRequest)return (await tokenRequest).clone();
  const work=(async()=>{
    const status=await hostedCodexAccountRequest("GET","/hub/codex-account",changed);
    if(!status.ok)return status;
    if((await status.json()).phase!=="connected")return new Response(null,{status:204});
    try {
      const tokens=JSON.parse(readFileSync(join(process.env.CODEX_HOME!,"auth.json"),"utf8")).tokens;
      if(typeof tokens?.access_token!=="string" || typeof tokens?.account_id!=="string")throw Error();
      return Response.json({accessToken:tokens.access_token,chatgptAccountId:tokens.account_id},{headers:{"cache-control":"no-store"}});
    }catch{return Response.json({error:"Reconnect Codex to continue."},{status:502});}
  })();
  tokenRequest=work;
  try{return (await work).clone();}finally{if(tokenRequest===work)tokenRequest=undefined;}
}
