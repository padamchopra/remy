export const hostedGatewayModel = (gateway:string, model:string) => `remy:${gateway}:${model}`;
export function hostedModelSelection(model:string | undefined) {
  const match=/^remy:(openrouter|router|openai):(.+)$/.exec(model ?? "");
  if(!match)return {model,provider:undefined};
  const key=match[1]==="openrouter"?"OPENROUTER_API_KEY":match[1]==="openai"?"OPENAI_API_KEY":"RAMP_ROUTER_API_KEY";
  if(!process.env[key])throw Error("This model provider is unavailable on this computer.");
  return {model:match[2],provider:`remy_${match[1]}`};
}
/// True when this computer has the gateway key, even if the model is not in
/// the last fetched catalogue.
export function hostedGatewayAvailable(model: string | undefined): boolean {
  try {
    return !!hostedModelSelection(model).provider;
  } catch {
    return false;
  }
}
export function hostedGatewayModels() {
  return ["router","openrouter"].flatMap(gateway=>{
    const prefix=gateway==="router"?"RAMP_ROUTER":"OPENROUTER";
    if(!process.env[`${prefix}_API_KEY`])return [];
    const models=JSON.parse(process.env[`${prefix}_MODELS`] ?? JSON.stringify(process.env[`${prefix}_MODEL`]?[process.env[`${prefix}_MODEL`]]:[])) as string[];
    return models.map(model=>({value:hostedGatewayModel(gateway,model),label:`${gateway==="router"?"Router.com":"OpenRouter"} · ${model}`}));
  });
}
