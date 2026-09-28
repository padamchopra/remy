import { isAbsolute, join } from "node:path";

export function localComputerEnvironment(source, state) {
  if (!isAbsolute(state)) throw new Error("Use an absolute development state directory.");
  const env = {...source};
  for (const key of Object.keys(env)) if (/^(MC_|REMY_)/.test(key)) delete env[key];
  if (env.CLAUDECODE) delete env.ANTHROPIC_BASE_URL;
  for (const key of Object.keys(env))
    if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/.test(key)) delete env[key];
  return {...env, MC_CONFIG_DIR:join(state, "computer")};
}

export function localComputerConfig(saved) {
  return {...saved, port:8421, hubMode:true, automaticUpdates:false};
}
