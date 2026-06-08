import { attachCliExecutionHandlers, startCliExecutionRun } from "./execution-backend-cli.js";
import { startWsExecutionRun } from "./execution-backend-ws.js";

const DEFAULT_EXECUTION_BACKEND = "cli";

export function resolveExecutionBackend(settings = {}) {
  const candidate = normalizeText(settings.executionBackend);
  if (candidate === "ws") return "ws";
  if (candidate === "cli") return "cli";
  return DEFAULT_EXECUTION_BACKEND;
}

export function startExecutionBackendRun({ backend, codexBin, args, cwd, env, spawnFn, wsBackendUrl, wsBackendAuthTokenEnv }) {
  const resolvedBackend = normalizeBackend(backend);
  if (resolvedBackend === "cli") {
    return startCliExecutionRun({ codexBin, args, cwd, env, spawnFn });
  }
  if (resolvedBackend === "ws") {
    return startWsExecutionRun({
      codexBin,
      args,
      cwd,
      env,
      spawnFn,
      wsBackendUrl,
      wsBackendAuthTokenEnv,
    });
  }
  throw new Error(`Unsupported execution backend: ${resolvedBackend}`);
}

export function attachExecutionBackendHandlers({ backend, child, onStdout, onStderr, onError, onClose }) {
  const resolvedBackend = normalizeBackend(backend);
  if (resolvedBackend === "cli" || resolvedBackend === "ws") {
    attachCliExecutionHandlers({ child, onStdout, onStderr, onError, onClose });
    return;
  }
  throw new Error(`Unsupported execution backend: ${resolvedBackend}`);
}

function normalizeBackend(value) {
  const normalized = normalizeText(value);
  return normalized || DEFAULT_EXECUTION_BACKEND;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}
