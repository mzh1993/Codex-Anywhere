import fs from "node:fs/promises";
import path from "node:path";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeBackupSuffix(nowIso) {
  return normalizeText(nowIso).replace(/[:]/g, "-");
}

async function backupFile(filePath, nowIso) {
  const backupPath = `${filePath}.bak-${makeBackupSuffix(nowIso)}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

function createPaths(bridgeStateRoot, senderId, taskId) {
  return {
    profilePath: path.join(bridgeStateRoot, "profiles", `${senderId}.json`),
    taskPath: path.join(bridgeStateRoot, "tasks", `${taskId}.json`),
  };
}

function validateInputs({ senderId, taskId }) {
  if (!normalizeText(senderId)) throw new Error("sender-id is required");
  if (!normalizeText(taskId)) throw new Error("task-id is required");
}

function validateReviveCandidate({ senderId, taskId, profile, task }) {
  if (normalizeText(profile?.senderId) !== senderId) {
    throw new Error(`profile sender mismatch for ${senderId}`);
  }
  if (normalizeText(task?.taskId) !== taskId) {
    throw new Error(`task id mismatch for ${taskId}`);
  }
  if (normalizeText(task?.senderId) !== senderId) {
    throw new Error(`task sender mismatch for ${taskId}`);
  }
  if (normalizeText(profile?.conversationId) && normalizeText(task?.conversationId)) {
    if (normalizeText(profile.conversationId) !== normalizeText(task.conversationId)) {
      throw new Error(`conversation mismatch for task ${taskId}`);
    }
  }
  if (normalizeText(task?.status) !== "aborted" || normalizeText(task?.error) !== "gateway stop") {
    throw new Error(`task ${taskId} is not a revivable gateway-stop lane`);
  }
}

function buildRevivedTask(task, nowIso) {
  return {
    ...task,
    status: "awaiting_input",
    currentRunId: null,
    updatedAt: nowIso,
    finishedAt: null,
    lastStatusHint: "run.interrupted",
    requiresExplicitContinue: true,
    error: null,
  };
}

function buildRevivedProfile(profile, task, nowIso) {
  const nextProfile = {
    ...profile,
    updatedAt: nowIso,
    activeTaskId: task.taskId,
    lastTaskId: task.taskId,
  };
  if (normalizeText(task?.sessionId)) {
    nextProfile.lastSessionId = task.sessionId;
  }
  return nextProfile;
}

export async function reviveTaskLane({
  bridgeStateRoot,
  senderId,
  taskId,
  dryRun = false,
  nowIso = new Date().toISOString(),
}) {
  validateInputs({ senderId, taskId });

  const paths = createPaths(bridgeStateRoot, senderId, taskId);
  const [profile, task] = await Promise.all([
    readJson(paths.profilePath),
    readJson(paths.taskPath),
  ]);

  validateReviveCandidate({ senderId, taskId, profile, task });

  const nextTask = buildRevivedTask(task, nowIso);
  const nextProfile = buildRevivedProfile(profile, nextTask, nowIso);

  if (dryRun) {
    return {
      applied: false,
      bridgeStateRoot,
      senderId,
      taskId,
      profile: nextProfile,
      task: nextTask,
      backups: [],
    };
  }

  const backups = [];
  backups.push(await backupFile(paths.profilePath, nowIso));
  backups.push(await backupFile(paths.taskPath, nowIso));

  await writeJson(paths.profilePath, nextProfile);
  await writeJson(paths.taskPath, nextTask);

  return {
    applied: true,
    bridgeStateRoot,
    senderId,
    taskId,
    profile: nextProfile,
    task: nextTask,
    backups,
  };
}
