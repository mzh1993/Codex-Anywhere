#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { reviveTaskLane } from "./lib/revive-task-lane-core.mjs";

function parseArgs(argv) {
  const parsed = {
    senderId: "",
    taskId: "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (token === "--sender-id") {
      parsed.senderId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--task-id") {
      parsed.taskId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${token}`);
  }

  return parsed;
}

function repoRootFromScript() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..");
}

function defaultBridgeStateRoot() {
  return path.join(repoRootFromScript(), ".isolated", "codex-feishu", "state", "codex-bridge");
}

function formatSummary(result) {
  return [
    result.applied ? "revive applied" : "revive dry-run",
    `sender_id: ${result.senderId}`,
    `task_id: ${result.taskId}`,
    `active_task_id: ${result.profile.activeTaskId}`,
    `cwd: ${result.task.cwd}`,
    `session_id: ${result.task.sessionId ?? ""}`,
    `status: ${result.task.status}`,
    `requires_explicit_continue: ${String(result.task.requiresExplicitContinue)}`,
    ...(result.backups.length > 0 ? ["backups:", ...result.backups.map((entry) => `- ${entry}`)] : []),
  ].join("\n");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const result = await reviveTaskLane({
    bridgeStateRoot: defaultBridgeStateRoot(),
    senderId: parsed.senderId,
    taskId: parsed.taskId,
    dryRun: parsed.dryRun,
  });
  process.stdout.write(`${formatSummary(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`revive failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
