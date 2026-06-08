import { spawn as defaultSpawn } from "node:child_process";

export function startWsExecutionRun({ codexBin, args, cwd, env, wsBackendUrl, wsBackendAuthTokenEnv, spawnFn = defaultSpawn }) {
  const remoteUrl = normalizeText(wsBackendUrl);
  if (!remoteUrl) throw new Error("ws backend requires wsBackendUrl");
  ensureWsUrl(remoteUrl);

  const wsArgs = ["--remote", remoteUrl];
  const authTokenEnv = normalizeText(wsBackendAuthTokenEnv);
  if (authTokenEnv) {
    wsArgs.push("--remote-auth-token-env", authTokenEnv);
  }

  return spawnFn(codexBin, [...wsArgs, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ensureWsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid ws backend url: ${value}`);
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`invalid ws backend url: ${value}`);
  }
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
