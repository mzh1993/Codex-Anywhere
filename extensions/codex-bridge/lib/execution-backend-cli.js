import { spawn as defaultSpawn } from "node:child_process";

export function startCliExecutionRun({ codexBin, args, cwd, env, spawnFn = defaultSpawn }) {
  return spawnFn(codexBin, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function attachCliExecutionHandlers({ child, onStdout, onStderr, onError, onClose }) {
  if (child.stdout && onStdout) {
    child.stdout.on("data", onStdout);
  }
  if (child.stderr && onStderr) {
    child.stderr.on("data", onStderr);
  }
  if (onError) {
    child.on("error", onError);
  }
  if (onClose) {
    child.on("close", onClose);
  }
}
