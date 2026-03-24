import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { definePluginEntry } from "../../.runtime/openclaw-2026.3.22/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js";
import { sendMessageFeishu } from "../../.runtime/openclaw-2026.3.22/node_modules/openclaw/dist/extensions/feishu/index.js";
import { buildCodexArgs, buildCodexEnv } from "./lib/codex-exec.js";
import { isPathInsideAny } from "./lib/fs-utils.js";
import { getLocaleText, localizeStatusHint } from "./lib/locale.js";
import { assessPolicyDecision, POLICY_DECISIONS } from "./lib/policy.js";
import { resolveSettings } from "./lib/settings.js";
import {
  isActiveTaskStatus,
  routeContinueCommand,
  routeIncomingPlainText,
  startNextRunFromApproval,
} from "./lib/task-model.js";
import {
  applyRunResultToPersistence,
  createAwaitingApprovalTaskRecord,
  createDeniedTaskPersistenceRecords,
  createRunRecord,
  createTaskPersistence,
  createTaskRecord,
  recoverStaleRunningTask,
} from "./lib/task-store.js";

const FEISHU_CHANNEL = "feishu";
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_MAX_CHANGED_FILES = 8;
const DEFAULT_ABORT_GRACE_MS = 5000;

const activeTasks = new Map();
export const __activeTasks = activeTasks;

export default definePluginEntry({
  id: "codex-bridge",
  name: "Codex Bridge",
  description: "Feishu remote Codex runner",
  register(api) {
    const bridge = new CodexBridge(api);
    api.logger.warn?.("codex-bridge register: plugin loaded");
    api.logger.warn?.(`codex-bridge state root: ${bridge.settings.stateRoot}`);
    globalThis.__codexFeishuBridgeClaim = async (event, ctx) => bridge.handleInboundClaim(event, ctx);
    api.on("inbound_claim", async (event, ctx) => bridge.handleInboundClaim(event, ctx));
    api.on("gateway_stop", async () => {
      delete globalThis.__codexFeishuBridgeClaim;
      await bridge.abortAll("gateway stop");
    });
  },
});

export class CodexBridge {
  constructor(api) {
    this.api = api;
    this.settings = resolveSettings(api);
    this.text = getLocaleText(this.settings.locale);
    const persistence = createTaskPersistence({
      tasksRoot: this.settings.tasksRoot,
      runsRoot: this.settings.runsRoot,
      readJson,
      writeJson,
      safeFileName,
    });
    this.taskStore = persistence.tasks;
    this.runStore = persistence.runs;
  }

  async handleInboundClaim(event, ctx) {
    const channel = event.channel ?? ctx.channelId;
    const conversationId = ctx.conversationId ?? event.conversationId;
    const senderId = event.senderId ?? ctx.senderId;
    const messageId = ctx.messageId ?? event.messageId ?? "";
    const accountId = ctx.accountId ?? event.accountId ?? DEFAULT_ACCOUNT_ID;
    const text = normalizeText(event.bodyForAgent ?? event.body ?? event.content);

    this.api.logger.info?.(`codex-bridge inbound_claim: channel=${channel ?? "<missing>"} account=${accountId} conversation=${conversationId ?? "<missing>"} sender=${senderId ?? "<missing>"} isGroup=${String(Boolean(event.isGroup))} text=${JSON.stringify(truncate(text || "", 120))}`);

    if (channel !== FEISHU_CHANNEL || event.isGroup) {
      this.api.logger.info?.("codex-bridge inbound_claim: decline (non-feishu or group)");
      return;
    }
    if (!conversationId || !senderId) {
      this.api.logger.warn?.(`codex-bridge inbound_claim: decline (missing routing fields conversation=${conversationId ?? "<missing>"} sender=${senderId ?? "<missing>"})`);
      return;
    }
    if (!text) {
      this.api.logger.info?.("codex-bridge inbound_claim: empty text => handled");
      return { handled: true };
    }
    if (shouldBypassClaim(text)) {
      this.api.logger.info?.(`codex-bridge inbound_claim: bypass command ${JSON.stringify(truncate(text, 80))}`);
      return;
    }

    const paired = await this.isSenderPaired(accountId, senderId);
    if (!paired) {
      this.api.logger.info?.(`codex-bridge inbound_claim: decline (sender not paired sender=${senderId} account=${accountId})`);
      return;
    }

    this.api.logger.info?.(`codex-bridge inbound_claim: claimed sender=${senderId} conversation=${conversationId}`);

    void this.routeInbound({
      accountId,
      conversationId,
      messageId,
      senderId,
      senderName: event.senderName ?? "",
      text,
    }).catch(async (error) => {
      this.api.logger.error(`codex-bridge route failed: ${toErrorText(error)}`);
      await this.safeReply({
        accountId,
        conversationId,
        messageId,
        text: this.text.bridgeError(toErrorText(error)),
      });
    });

    return { handled: true };
  }

  async routeInbound(request) {
    await ensureDir(this.settings.stateRoot);
    await Promise.all([
      ensureDir(this.settings.profilesRoot),
      ensureDir(this.settings.tasksRoot),
      ensureDir(this.settings.approvalsRoot),
      ensureDir(this.settings.runsRoot),
    ]);

    const profile = await this.loadProfile(request.senderId, {
      senderId: request.senderId,
      accountId: request.accountId,
      conversationId: request.conversationId,
      defaultCwd: this.settings.defaultCwd,
      updatedAt: new Date().toISOString(),
    });
    profile.accountId = request.accountId;
    profile.conversationId = request.conversationId;
    profile.updatedAt = new Date().toISOString();

    if (isCodexCommand(request.text)) {
      await this.handleCommand(profile, request);
      return;
    }

    const activeTask = await this.loadActiveTask(profile.senderId, profile);
    if (activeTask) {
      const routeResult = routeIncomingPlainText({
        activeTaskStatus: activeTask.status,
        requiresExplicitContinue: activeTask.requiresExplicitContinue,
      });
      if (routeResult.action === "continue_task") {
        await this.queueOrStartTask({
          profile,
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          mode: this.getNextRunMode(activeTask),
          prompt: request.text,
          cwd: activeTask.cwd,
          senderName: request.senderName,
          existingTask: activeTask,
        });
        return;
      }
      if (routeResult.code === "task_interrupted_requires_continue") {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.interruptedTaskRequiresContinue(activeTask.taskId),
        });
        return;
      }
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.taskAlreadyRunning({
          taskId: activeTask.taskId,
          status: activeTask.status,
          code: routeResult.code,
          suggestedCommand: routeResult.suggestedCommand,
        }),
      });
      return;
    }

    await this.queueOrStartTask({
      profile,
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      mode: "new",
      prompt: request.text,
      cwd: profile.defaultCwd || this.settings.defaultCwd,
      senderName: request.senderName,
    });
  }

  async handleCommand(profile, request) {
    const parsed = parseCodexCommand(request.text);
    if (!parsed) {
      await this.sendHelp(request, profile);
      return;
    }

    if (parsed.name === "help") {
      await this.sendHelp(request, profile);
      return;
    }

    if (parsed.name === "pwd") {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.currentCwd(profile.defaultCwd || this.settings.defaultCwd),
      });
      return;
    }

    if (parsed.name === "cwd") {
      if (!parsed.args) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.usageCwd,
        });
        return;
      }
      const nextCwd = expandUserPath(parsed.args, profile.defaultCwd || this.settings.defaultCwd);
      await assertAllowedCwd(nextCwd, this.settings);
      const stat = await fsp.stat(nextCwd).catch(() => null);
      if (!stat?.isDirectory()) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.directoryNotFound(nextCwd),
        });
        return;
      }
      profile.defaultCwd = nextCwd;
      profile.updatedAt = new Date().toISOString();
      await this.saveProfile(profile);
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.defaultCwdUpdated(nextCwd),
      });
      return;
    }

    if (parsed.name === "status") {
      const statusText = await this.formatStatus(profile.senderId);
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: statusText,
      });
      return;
    }

    if (parsed.name === "abort") {
      const activeTask = await this.loadActiveTask(profile.senderId, profile);
      if (!activeTask) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.noRunningTaskToAbort,
        });
        return;
      }
      if (this.getActiveTask(profile.senderId)?.taskId === activeTask.taskId) {
        await this.stopTask(activeTask, "aborted by user");
      } else {
        await this.finalizeStoredTask(activeTask, profile, {
          status: "aborted",
          error: "aborted by user",
        });
      }
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.abortRequested(activeTask.taskId),
      });
      return;
    }

    if (parsed.name === "approve") {
      if (!parsed.args) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.usageApprove,
        });
        return;
      }
      await this.approvePendingRequest(profile, request, parsed.args.trim());
      return;
    }

    if (parsed.name === "continue") {
      if (!parsed.args) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.usageContinue,
        });
        return;
      }
      const activeTask = await this.loadActiveTask(profile.senderId, profile);
      const continueRoute = routeContinueCommand({ activeTaskStatus: activeTask?.status ?? null });
      if (!continueRoute.accepted) {
        if (activeTask) {
          await this.safeReply({
            accountId: request.accountId,
            conversationId: request.conversationId,
            messageId: request.messageId,
            text: this.text.taskAlreadyRunning({
              taskId: activeTask.taskId,
              status: activeTask.status,
              code: continueRoute.code,
              suggestedCommand: continueRoute.suggestedCommand,
            }),
          });
          return;
        }
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.noActiveTaskToContinue,
        });
        return;
      }
      await this.queueOrStartTask({
        profile,
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        mode: this.getNextRunMode(activeTask),
        prompt: parsed.args,
        cwd: activeTask.cwd,
        senderName: request.senderName,
        existingTask: activeTask,
      });
      return;
    }

    await this.sendHelp(request, profile);
  }

  async sendHelp(request, profile) {
    const cwd = profile.defaultCwd || this.settings.defaultCwd;
    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: this.text.help(cwd),
    });
  }

  async approvePendingRequest(profile, request, token) {
    const approval = await this.readApproval(token);
    if (!approval) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenNotFound(token),
      });
      return;
    }
    if (approval.senderId !== request.senderId) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenDifferentDm,
      });
      return;
    }
    if (Date.now() > approval.expiresAtMs) {
      await this.deleteApproval(token);
      const expiredTask = approval.taskId ? await this.readTask(approval.taskId) : null;
      if (expiredTask) {
        await this.finalizeStoredTask(expiredTask, profile, {
          status: "aborted",
          error: "approval token expired",
        });
      } else if (profile.pendingApprovalToken === token) {
        delete profile.pendingApprovalToken;
        await this.saveProfile(profile);
      }
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenExpired(token),
      });
      return;
    }

    await this.deleteApproval(token);
    if (profile.pendingApprovalToken === token) delete profile.pendingApprovalToken;
    await this.saveProfile(profile);

    const existingTask = approval.taskId ? await this.readTask(approval.taskId) : null;
    const nextRun = startNextRunFromApproval();

    await this.startTask({
      profile,
      accountId: approval.accountId,
      conversationId: approval.conversationId,
      messageId: approval.messageId,
      mode: approval.sessionId ? "resume" : approval.mode,
      prompt: approval.prompt,
      cwd: approval.cwd,
      sessionId: approval.sessionId,
      policyDecision: approval.policyDecision ?? POLICY_DECISIONS.APPROVAL_REQUIRED,
      reasonCodes: approval.reasonCodes ?? approval.riskReasons ?? [],
      riskLevel: "high",
      approvalToken: null,
      status: nextRun.taskStatus,
      existingTask,
    });
  }

  async queueOrStartTask(params) {
    const cwd = expandUserPath(params.cwd, this.settings.defaultCwd);
    await assertAllowedCwd(cwd, this.settings);
    const decision = assessPolicyDecision({
      prompt: params.prompt,
      cwd,
      protectedRoots: this.settings.policyProtectedRoots,
      hostCodexRoot: this.settings.hostCodexRoot,
    });
    const reasonCodes = decision.reasonCodes ?? [];

    if (decision.kind === POLICY_DECISIONS.DENIED) {
      if (params.existingTask) {
        await this.persistDeniedRun(params, { cwd, decision });
      } else {
        await this.persistDeniedTask(params, { cwd, decision });
      }
      await this.safeReply({
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        text: this.text.requestRejected(reasonCodes),
      });
      return;
    }

    if (decision.kind === POLICY_DECISIONS.APPROVAL_REQUIRED) {
      if (params.existingTask) {
        await this.queueApprovalForExistingTask(params, { cwd, decision });
        return;
      }
      const taskId = makeTaskId();
      const runId = makeRunId();
      const token = makeApprovalToken();
      const task = createAwaitingApprovalTaskRecord({
        taskId,
        locale: this.settings.locale,
        senderId: params.profile.senderId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        cwd,
        mode: params.mode,
        sessionId: params.sessionId ?? null,
        approvalToken: token,
        prompt: params.prompt,
        policyDecision: decision.kind,
        reasonCodes,
        currentRunId: runId,
        lastRunId: runId,
      });
      const run = createRunRecord({
        runId,
        taskId,
        locale: this.settings.locale,
        senderId: params.profile.senderId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        cwd,
        mode: params.mode,
        sessionId: params.sessionId ?? null,
        status: "blocked",
        riskLevel: "high",
        approvalToken: token,
        prompt: params.prompt,
        policyDecision: decision.kind,
        reasonCodes,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        updatedAt: task.updatedAt,
        finishedAt: task.updatedAt,
      });
      const approval = {
        token,
        taskId,
        senderId: params.profile.senderId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        mode: params.mode,
        prompt: params.prompt,
        cwd,
        sessionId: params.sessionId ?? null,
        policyDecision: decision.kind,
        reasonCodes,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + this.settings.approvalTtlMs,
      };
      await this.saveTask(task);
      await this.saveRun(run);
      await this.writeApproval(approval);
      params.profile.activeTaskId = taskId;
      params.profile.lastTaskId = taskId;
      params.profile.pendingApprovalToken = token;
      params.profile.updatedAt = new Date().toISOString();
      await this.saveProfile(params.profile);
      await this.safeReply({
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        text: this.text.approvalQueued({
          token,
          mode: params.mode,
          cwd,
          reasons: reasonCodes,
          status: task.status,
        }),
      });
      return;
    }

    await this.startTask({
      ...params,
      cwd,
      policyDecision: decision.kind,
      reasonCodes,
      riskLevel: "normal",
    });
  }

  async persistDeniedTask(params, { cwd, decision }) {
    const timestamp = new Date().toISOString();
    const taskId = makeTaskId();
    const runId = makeRunId();
    const { task, run } = createDeniedTaskPersistenceRecords({
      taskId,
      runId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd,
      mode: params.mode,
      sessionId: params.sessionId ?? null,
      prompt: params.prompt,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      timestamp,
    });
    params.profile.activeTaskId = taskId;
    params.profile.lastTaskId = taskId;
    params.profile.updatedAt = timestamp;
    await this.saveProfile(params.profile);
    await this.saveTask(task);
    await this.saveRun(run);
  }

  async persistDeniedRun(params, { cwd, decision }) {
    const timestamp = new Date().toISOString();
    const runId = makeRunId();
    const run = createRunRecord({
      runId,
      taskId: params.existingTask.taskId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd,
      mode: params.mode,
      sessionId: params.existingTask.sessionId ?? null,
      status: "blocked",
      riskLevel: "normal",
      approvalToken: null,
      prompt: params.prompt,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: timestamp,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: null,
    });
    const task = createTaskRecord({
      ...params.existingTask,
      locale: this.settings.locale,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd,
      mode: params.mode,
      status: "awaiting_input",
      currentRunId: null,
      lastRunId: runId,
      approvalToken: null,
      prompt: params.prompt,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      riskLevel: "normal",
      updatedAt: timestamp,
      finishedAt: null,
      error: null,
    });
    params.profile.activeTaskId = task.taskId;
    params.profile.lastTaskId = task.taskId;
    params.profile.updatedAt = timestamp;
    await this.saveProfile(params.profile);
    await this.saveTask(task);
    await this.saveRun(run);
  }

  async queueApprovalForExistingTask(params, { cwd, decision }) {
    const timestamp = new Date().toISOString();
    const runId = makeRunId();
    const token = makeApprovalToken();
    const task = createTaskRecord({
      ...params.existingTask,
      locale: this.settings.locale,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd,
      mode: params.mode,
      status: "awaiting_approval",
      currentRunId: null,
      lastRunId: runId,
      riskLevel: "high",
      approvalToken: token,
      prompt: params.prompt,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      updatedAt: timestamp,
      finishedAt: null,
      error: null,
    });
    const run = createRunRecord({
      runId,
      taskId: task.taskId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd,
      mode: params.mode,
      sessionId: params.existingTask.sessionId ?? null,
      status: "blocked",
      riskLevel: "high",
      approvalToken: token,
      prompt: params.prompt,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: timestamp,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: null,
    });
    const approval = {
      token,
      taskId: task.taskId,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      mode: params.mode,
      prompt: params.prompt,
      cwd,
      sessionId: params.existingTask.sessionId ?? null,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + this.settings.approvalTtlMs,
    };
    await this.saveTask(task);
    await this.saveRun(run);
    await this.writeApproval(approval);
    params.profile.activeTaskId = task.taskId;
    params.profile.lastTaskId = task.taskId;
    params.profile.pendingApprovalToken = token;
    params.profile.updatedAt = timestamp;
    await this.saveProfile(params.profile);
    await this.safeReply({
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      text: this.text.approvalQueued({
        token,
        mode: params.mode,
        cwd,
        reasons: decision.reasonCodes ?? [],
        status: task.status,
      }),
    });
  }

  async startTask(params) {
    const activeTask = this.getActiveTask(params.profile.senderId);
    if (activeTask && activeTask.taskId !== params.existingTask?.taskId) {
      await this.safeReply({
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        text: this.text.taskAlreadyRunning({
          taskId: activeTask.taskId,
          status: activeTask.status,
          code: "active_task_exists",
        }),
      });
      return;
    }

    await this.ensureCodexHome();

    const timestamp = new Date().toISOString();
    const taskId = params.existingTask?.taskId ?? makeTaskId();
    const runId = makeRunId();
    const runDir = path.join(this.settings.runsRoot, runId);
    await ensureDir(runDir);
    const lastMessagePath = path.join(runDir, "last-message.txt");
    const stdoutLogPath = path.join(runDir, "stdout.jsonl");
    const stderrLogPath = path.join(runDir, "stderr.log");
    const beforeSessions = await this.snapshotSessionFiles();

    const task = createTaskRecord({
      ...params.existingTask,
      taskId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd: params.cwd,
      mode: params.mode,
      sessionId: params.sessionId ?? params.existingTask?.sessionId ?? null,
      status: "running",
      currentRunId: runId,
      lastRunId: runId,
      riskLevel: params.riskLevel ?? params.existingTask?.riskLevel ?? "normal",
      approvalToken: params.approvalToken ?? null,
      policyDecision: params.policyDecision ?? params.existingTask?.policyDecision ?? POLICY_DECISIONS.ALLOWED,
      reasonCodes: params.reasonCodes ?? params.existingTask?.reasonCodes ?? [],
      prompt: params.prompt,
      createdAt: params.existingTask?.createdAt ?? timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
      lastStatusHint: null,
      lastStatusSentAtMs: 0,
      lastHeartbeatAtMs: 0,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: null,
    });
    const run = createRunRecord({
      runId,
      taskId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd: params.cwd,
      mode: params.mode,
      sessionId: task.sessionId,
      status: "running",
      riskLevel: task.riskLevel,
      approvalToken: task.approvalToken,
      prompt: params.prompt,
      policyDecision: task.policyDecision,
      reasonCodes: task.reasonCodes,
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
      exitCode: null,
      signal: null,
      pid: null,
      lastStatusHint: null,
      lastStatusSentAtMs: 0,
      lastHeartbeatAtMs: 0,
      beforeSessions,
      stdoutLogPath,
      stderrLogPath,
      lastMessagePath,
      runDir,
      summary: null,
      changedFiles: [],
      nextSteps: [],
      error: null,
    });

    params.profile.activeTaskId = taskId;
    params.profile.lastTaskId = taskId;
    if (task.approvalToken && params.profile.pendingApprovalToken === task.approvalToken) {
      delete params.profile.pendingApprovalToken;
    }
    params.profile.updatedAt = new Date().toISOString();
    await this.saveProfile(params.profile);
    await this.saveTask(task);
    await this.saveRun(run);

    const args = buildCodexArgs({
      task,
      settings: this.settings,
      outputPath: run.lastMessagePath,
    });
    const env = buildCodexEnv({
      codexHome: this.settings.codexHome,
      inheritedEnv: process.env,
      envAllowlist: this.settings.envAllowlist,
    });
    const child = spawn(this.settings.codexBin, args, {
      cwd: params.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    run.pid = child.pid ?? null;
    activeTasks.set(task.senderId, {
      task,
      run,
      child,
      stdoutBuffer: "",
      stderrBuffer: "",
      heartbeatTimer: null,
      sessionPollTimer: null,
      stopping: false,
    });
    await this.saveTask(task);
    await this.saveRun(run);

    await this.safeReply({
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      text: this.text.taskStarted(task),
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        void this.handleStdout(task.senderId, chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        void this.handleStderr(task.senderId, chunk);
      });
    }
    child.on("error", (error) => {
      void this.finishTask(task.senderId, {
        exitCode: null,
        signal: null,
        error: toErrorText(error),
      });
    });
    child.on("close", (code, signal) => {
      void this.finishTask(task.senderId, {
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
        error: null,
      });
    });

    const runtime = activeTasks.get(task.senderId);
    if (!runtime) return;
    runtime.heartbeatTimer = setInterval(() => {
      void this.maybeSendHeartbeat(task.senderId);
    }, this.settings.heartbeatMs);
    runtime.sessionPollTimer = setInterval(() => {
      void this.maybeResolveSessionId(task.senderId);
    }, 2000);
  }

  async handleStdout(senderId, chunk) {
    try {
      const runtime = activeTasks.get(senderId);
      if (!runtime) return;
      const text = String(chunk);
      await appendFile(runtime.run.stdoutLogPath, text);
      runtime.stdoutBuffer += text;
      const lines = runtime.stdoutBuffer.split(/\r?\n/);
      runtime.stdoutBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const parsed = safeJsonParse(line);
        const hint = parsed ? extractStatusHint(parsed) : undefined;
        if (hint) {
          runtime.task.lastStatusHint = hint;
          runtime.run.lastStatusHint = hint;
          runtime.task.updatedAt = new Date().toISOString();
          runtime.run.updatedAt = runtime.task.updatedAt;
          await this.saveTask(runtime.task);
          await this.saveRun(runtime.run);
          await this.maybeSendStatusHint(runtime.task, hint);
        }
        if (!runtime.task.sessionId) {
          const sessionId = findSessionIdInText(line);
          if (sessionId) {
            runtime.task.sessionId = sessionId;
            runtime.run.sessionId = sessionId;
            await this.onTaskSessionResolved(runtime.task);
          }
        }
      }
    } catch (error) {
      await this.handleRuntimePersistenceFailure(senderId, error);
    }
  }

  async handleStderr(senderId, chunk) {
    try {
      const runtime = activeTasks.get(senderId);
      if (!runtime) return;
      const text = String(chunk);
      await appendFile(runtime.run.stderrLogPath, text);
      runtime.stderrBuffer += text;
      const lines = runtime.stderrBuffer.split(/\r?\n/);
      runtime.stderrBuffer = lines.pop() ?? "";
      let lastWarning = null;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (looksLikeBenignCodexWarning(line)) continue;
        lastWarning = line;
      }
      if (lastWarning) {
        runtime.task.lastStatusHint = `stderr: ${truncate(lastWarning, 180)}`;
        runtime.run.lastStatusHint = runtime.task.lastStatusHint;
        runtime.task.updatedAt = new Date().toISOString();
        runtime.run.updatedAt = runtime.task.updatedAt;
        await this.saveTask(runtime.task);
        await this.saveRun(runtime.run);
      }
    } catch (error) {
      await this.handleRuntimePersistenceFailure(senderId, error);
    }
  }

  async maybeSendStatusHint(task, hint) {
    const now = Date.now();
    if (now - task.lastStatusSentAtMs < this.settings.statusThrottleMs) return;
    task.lastStatusSentAtMs = now;
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);
    await this.safeReply({
      accountId: task.accountId,
      conversationId: task.conversationId,
      text: this.text.taskProgress(task.taskId, hint),
    });
  }

  async maybeSendHeartbeat(senderId) {
    try {
      const runtime = activeTasks.get(senderId);
      if (!runtime) return;
      const now = Date.now();
      if (now - runtime.task.lastHeartbeatAtMs < this.settings.heartbeatMs) return;
      runtime.task.lastHeartbeatAtMs = now;
      runtime.task.updatedAt = new Date().toISOString();
      await this.saveTask(runtime.task);
      const elapsed = formatElapsed(runtime.task.startedAt);
      const suffix = runtime.task.lastStatusHint ? `\n${this.text.lastLabel}: ${localizeStatusHint(this.settings.locale, runtime.task.lastStatusHint)}` : "";
      await this.safeReply({
        accountId: runtime.task.accountId,
        conversationId: runtime.task.conversationId,
        text: this.text.taskStillRunning(runtime.task.taskId, elapsed, suffix),
      });
    } catch (error) {
      await this.handleRuntimePersistenceFailure(senderId, error);
    }
  }

  async maybeResolveSessionId(senderId) {
    try {
      const runtime = activeTasks.get(senderId);
      if (!runtime || runtime.task.sessionId) return;
      const snapshot = await this.snapshotSessionFiles();
      const candidate = findNewSessionId(runtime.run.beforeSessions, snapshot);
      if (!candidate) return;
      runtime.task.sessionId = candidate;
      await this.onTaskSessionResolved(runtime.task);
    } catch (error) {
      await this.handleRuntimePersistenceFailure(senderId, error);
    }
  }

  async onTaskSessionResolved(task) {
    const profile = await this.loadProfile(task.senderId, null);
    if (profile) {
      profile.lastSessionId = task.sessionId;
      profile.updatedAt = new Date().toISOString();
      await this.saveProfile(profile);
    }
    const runtime = activeTasks.get(task.senderId);
    if (runtime?.task.taskId === task.taskId) {
      runtime.run.sessionId = task.sessionId;
      runtime.run.updatedAt = new Date().toISOString();
      await this.saveRun(runtime.run);
    }
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);
  }

  async finishTask(senderId, result) {
    const runtime = activeTasks.get(senderId);
    if (!runtime || runtime.finishing) return;
    runtime.finishing = true;
    try {
      if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
      if (runtime.sessionPollTimer) clearInterval(runtime.sessionPollTimer);

      const task = runtime.task;
      const run = runtime.run;
      if (runtime.stdoutBuffer) await appendFile(run.stdoutLogPath, runtime.stdoutBuffer);
      if (runtime.stderrBuffer) await appendFile(run.stderrLogPath, runtime.stderrBuffer);

      if (!task.sessionId) {
        const snapshot = await this.snapshotSessionFiles();
        const candidate = findNewSessionId(run.beforeSessions, snapshot);
        if (candidate) task.sessionId = candidate;
      }
      if (task.sessionId) await this.onTaskSessionResolved(task);

      const lastMessage = await readText(run.lastMessagePath);
      const finalSummary = normalizeText(lastMessage);
      const changedFiles = extractChangedFiles(finalSummary);
      const nextSteps = extractNextSteps(finalSummary);
      const persisted = applyRunResultToPersistence({
        task,
        run,
        result: {
          ...result,
          stopping: runtime.stopping,
        },
        summary: finalSummary,
        changedFiles,
        nextSteps,
        sessionId: task.sessionId ?? run.sessionId ?? null,
      });
      const nextTask = persisted.task;
      const nextRun = persisted.run;
      await this.saveTask(nextTask);
      await this.saveRun(nextRun);

      const profile = await this.loadProfile(senderId, null);
      if (profile) {
        if (isActiveTaskStatus(nextTask.status)) profile.activeTaskId = nextTask.taskId;
        else if (profile.activeTaskId === nextTask.taskId) delete profile.activeTaskId;
        if (nextTask.sessionId) profile.lastSessionId = nextTask.sessionId;
        profile.lastTaskId = nextTask.taskId;
        profile.updatedAt = new Date().toISOString();
        await this.saveProfile(profile);
      }

      activeTasks.delete(senderId);
      await this.safeReply({
        accountId: nextTask.accountId,
        conversationId: nextTask.conversationId,
        text: this.text.taskFinished({ ...nextTask, runStatus: nextRun.status }),
      });
    } catch (error) {
      runtime.finishing = false;
      await this.handleRuntimePersistenceFailure(senderId, error);
    }
  }

  async stopTask(task, reason) {
    try {
      const runtime = activeTasks.get(task.senderId);
      if (!runtime || runtime.stopping) return;
      runtime.stopping = true;
      task.updatedAt = new Date().toISOString();
      task.error = reason;
      await this.saveTask(task);
      runtime.run.error = reason;
      runtime.run.updatedAt = task.updatedAt;
      await this.saveRun(runtime.run);
      runtime.child.kill("SIGTERM");
      setTimeout(() => {
        if (activeTasks.has(task.senderId)) runtime.child.kill("SIGKILL");
      }, DEFAULT_ABORT_GRACE_MS).unref?.();
    } catch (error) {
      await this.handleRuntimePersistenceFailure(task.senderId, error);
    }
  }

  async abortAll(reason) {
    const tasks = Array.from(activeTasks.values()).map((entry) => entry.task);
    for (const task of tasks) {
      await this.stopTask(task, reason);
    }
  }

  getActiveTask(senderId) {
    return activeTasks.get(senderId)?.task ?? null;
  }

  getNextRunMode(task) {
    return task.sessionId ? "resume" : "new";
  }

  async formatStatus(senderId) {
    const activeTask = await this.loadActiveTask(senderId);
    if (activeTask) {
      const lines = [
        this.text.activeTaskLine(activeTask.taskId),
        this.text.statusLine(activeTask.status),
        this.text.cwdLine(activeTask.cwd),
        this.text.modeLine(activeTask.mode),
        this.text.riskLine(activeTask.riskLevel),
        this.text.elapsedLine(formatElapsed(activeTask.startedAt ?? activeTask.createdAt)),
      ];
      if (activeTask.sessionId) lines.push(this.text.sessionIdLine(activeTask.sessionId));
      if (activeTask.approvalToken) lines.push(this.text.pendingApprovalLine(activeTask.approvalToken));
      if (activeTask.lastStatusHint) lines.push(this.text.lastLine(localizeStatusHint(this.settings.locale, activeTask.lastStatusHint)));
      return lines.join("\n");
    }

    const profile = await this.loadProfile(senderId, null);
    if (!profile) return this.text.noBridgeState;
    const lines = [
      this.text.noActiveTask,
      this.text.cwdLine(profile.defaultCwd || this.settings.defaultCwd),
    ];
    if (profile.lastTaskId) lines.push(this.text.lastTaskIdLine(profile.lastTaskId));
    if (profile.lastSessionId) lines.push(this.text.lastSessionIdLine(profile.lastSessionId));
    if (profile.pendingApprovalToken) lines.push(this.text.pendingApprovalLine(profile.pendingApprovalToken));
    return lines.join("\n");
  }

  async isSenderPaired(accountId, senderId) {
    try {
      const allowFrom = await this.api.runtime.channel.pairing.readAllowFromStore({
        channel: FEISHU_CHANNEL,
        accountId,
        env: process.env,
      });
      this.api.logger.info?.(`codex-bridge pairing read: account=${accountId} sender=${senderId} allowFrom=${JSON.stringify(allowFrom)}`);
      return allowFrom.some((entry) => {
        const value = String(entry).trim();
        return value === "*" || value === senderId;
      });
    } catch (error) {
      this.api.logger.warn(`codex-bridge pairing read failed: ${toErrorText(error)}`);
      return false;
    }
  }

  async safeReply(params) {
    try {
      const cfg = this.api.runtime.config.loadConfig();
      await sendMessageFeishu({
        cfg,
        accountId: params.accountId,
        to: params.conversationId,
        replyToMessageId: params.messageId || undefined,
        text: params.text,
      });
    } catch (error) {
      this.api.logger.error(`codex-bridge reply failed: ${toErrorText(error)}`);
    }
  }

  async ensureCodexHome() {
    await ensureDir(this.settings.codexHome);
    await ensureDir(path.join(this.settings.codexHome, "sessions"));
    await ensureSeedFile(this.settings.authJsonPath, path.join(this.settings.codexHome, "auth.json"));
    await ensureSeedFile(this.settings.configTomlPath, path.join(this.settings.codexHome, "config.toml"));
  }

  profilePath(senderId) {
    return path.join(this.settings.profilesRoot, `${safeFileName(senderId)}.json`);
  }

  approvalPath(token) {
    return path.join(this.settings.approvalsRoot, `${safeFileName(token)}.json`);
  }

  async loadProfile(senderId, fallback) {
    return readJson(this.profilePath(senderId), fallback);
  }

  async saveProfile(profile) {
    await writeJson(this.profilePath(profile.senderId), profile);
  }

  async readTask(taskId) {
    return this.taskStore.read(taskId);
  }

  async saveTask(task) {
    await this.taskStore.write(task);
  }

  async readRun(runId) {
    return this.runStore.read(runId);
  }

  async saveRun(run) {
    await this.runStore.write(run);
  }

  async readApproval(token) {
    return readJson(this.approvalPath(token), null);
  }

  async writeApproval(approval) {
    await writeJson(this.approvalPath(approval.token), approval);
  }

  async deleteApproval(token) {
    await fsp.rm(this.approvalPath(token), { force: true });
  }

  async loadActiveTask(senderId, profile = null) {
    const liveTask = this.getActiveTask(senderId);
    if (liveTask) return liveTask;

    const currentProfile = profile ?? (await this.loadProfile(senderId, null));
    if (!currentProfile?.activeTaskId) return null;

    let task = await this.readTask(currentProfile.activeTaskId);
    if (!task) {
      delete currentProfile.activeTaskId;
      if (currentProfile.pendingApprovalToken) delete currentProfile.pendingApprovalToken;
      currentProfile.updatedAt = new Date().toISOString();
      await this.saveProfile(currentProfile);
      return null;
    }

    if (task.status === "awaiting_approval" && task.approvalToken) {
      const approval = await this.readApproval(task.approvalToken);
      if (!approval || Date.now() > approval.expiresAtMs) {
        if (approval) await this.deleteApproval(task.approvalToken);
        await this.finalizeStoredTask(task, currentProfile, {
          status: "aborted",
          error: "approval token expired",
        });
        return null;
      }
    }

    if (task.status === "running") {
      const run = task.currentRunId ? await this.readRun(task.currentRunId) : null;
      const recovered = recoverStaleRunningTask({
        task,
        run,
      });
      task = recovered.task;
      await this.saveTask(task);
      if (recovered.run) await this.saveRun(recovered.run);
    }

    if (isActiveTaskStatus(task.status)) return task;

    delete currentProfile.activeTaskId;
    if (currentProfile.pendingApprovalToken === task.approvalToken) {
      delete currentProfile.pendingApprovalToken;
    }
    currentProfile.updatedAt = new Date().toISOString();
    await this.saveProfile(currentProfile);
    return null;
  }

  async finalizeStoredTask(task, profile, result) {
    if (task.approvalToken) {
      await this.deleteApproval(task.approvalToken);
    }
    const timestamp = new Date().toISOString();
    if (task.currentRunId) {
      const run = await this.readRun(task.currentRunId);
      if (run) {
        run.status = result.status === "aborted" ? "aborted" : run.status;
        run.error = result.error ?? run.error;
        run.finishedAt = timestamp;
        run.updatedAt = timestamp;
        await this.saveRun(run);
      }
    }
    task.status = result.status;
    task.currentRunId = null;
    task.error = result.error ?? task.error;
    task.finishedAt = timestamp;
    task.updatedAt = timestamp;
    await this.saveTask(task);

    if (profile.activeTaskId === task.taskId) delete profile.activeTaskId;
    if (profile.pendingApprovalToken === task.approvalToken) delete profile.pendingApprovalToken;
    profile.lastTaskId = task.taskId;
    profile.updatedAt = timestamp;
    await this.saveProfile(profile);
  }

  async snapshotSessionFiles() {
    const root = path.join(this.settings.codexHome, "sessions");
    const files = new Set();
    if (!fs.existsSync(root)) return files;
    for (const file of await listFilesRecursive(root)) files.add(file);
    return files;
  }

  async handleRuntimePersistenceFailure(senderId, error) {
    const runtime = activeTasks.get(senderId);
    this.api.logger.error?.(`codex-bridge runtime persistence failure: sender=${senderId} error=${toErrorText(error)}`);
    if (!runtime || runtime.recoveringFromPersistenceFailure) return;
    runtime.recoveringFromPersistenceFailure = true;

    if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
    if (runtime.sessionPollTimer) clearInterval(runtime.sessionPollTimer);
    activeTasks.delete(senderId);

    try {
      runtime.child.kill?.("SIGTERM");
    } catch (killError) {
      this.api.logger.warn?.(`codex-bridge runtime kill failed: ${toErrorText(killError)}`);
    }
    setTimeout(() => {
      try {
        runtime.child.kill?.("SIGKILL");
      } catch (killError) {
        this.api.logger.warn?.(`codex-bridge runtime force-kill failed: ${toErrorText(killError)}`);
      }
    }, DEFAULT_ABORT_GRACE_MS).unref?.();

    const recovered = recoverStaleRunningTask({
      task: runtime.task,
      run: runtime.run
        ? {
            ...runtime.run,
            error: runtime.run.error ?? `runtime persistence failure: ${toErrorText(error)}`,
          }
        : null,
    });

    await this.persistRecoveredRuntimeState(runtime, recovered, error);

    await this.safeReply({
      accountId: runtime.task.accountId,
      conversationId: runtime.task.conversationId,
      messageId: runtime.task.messageId,
      text: this.text.interruptedTaskRequiresContinue(runtime.task.taskId),
    });
  }

  async persistRecoveredRuntimeState(runtime, recovered, error) {
    try {
      await this.saveTask(recovered.task);
    } catch (taskError) {
      this.api.logger.error?.(`codex-bridge recovered task persistence failed: ${toErrorText(taskError)}`);
    }

    if (recovered.run) {
      try {
        await this.saveRun(recovered.run);
      } catch (runError) {
        this.api.logger.error?.(`codex-bridge recovered run persistence failed: ${toErrorText(runError)}`);
      }
    }

    const profile = await this.loadProfile(runtime.task.senderId, null).catch((profileError) => {
      this.api.logger.error?.(`codex-bridge recovered profile load failed: ${toErrorText(profileError)}`);
      return null;
    });
    if (!profile) return;

    profile.activeTaskId = recovered.task.taskId;
    profile.lastTaskId = recovered.task.taskId;
    if (recovered.task.sessionId) profile.lastSessionId = recovered.task.sessionId;
    if (profile.pendingApprovalToken === runtime.task.approvalToken) delete profile.pendingApprovalToken;
    profile.updatedAt = new Date().toISOString();

    try {
      await this.saveProfile(profile);
    } catch (profileSaveError) {
      this.api.logger.error?.(`codex-bridge recovered profile persistence failed: ${toErrorText(profileSaveError)}`);
      this.api.logger.error?.(`codex-bridge recovery degraded after sender=${runtime.task.senderId}: ${toErrorText(error)}`);
    }
  }
}

function parseCodexCommand(text) {
  const normalized = normalizeText(text);
  if (!normalized?.startsWith("/codex")) return null;
  const rest = normalized.slice("/codex".length).trim();
  if (!rest) return { name: "help", args: "" };
  const firstSpace = rest.indexOf(" ");
  if (firstSpace === -1) return { name: rest.toLowerCase(), args: "" };
  return {
    name: rest.slice(0, firstSpace).toLowerCase(),
    args: rest.slice(firstSpace + 1).trim(),
  };
}

function isCodexCommand(text) {
  return normalizeText(text)?.startsWith("/codex") ?? false;
}

function shouldBypassClaim(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (!normalized.startsWith("/")) return false;
  return !normalized.startsWith("/codex");
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function expandUserPath(input, baseDir) {
  const normalized = normalizeText(input);
  if (!normalized) return baseDir;
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  if (path.isAbsolute(normalized)) return path.normalize(normalized);
  return path.resolve(baseDir, normalized);
}

async function assertAllowedCwd(cwd, settings) {
  if (isPathInsideAny(cwd, settings.policyProtectedRoots)) {
    throw new Error(getLocaleText(settings.locale).cwdBlocked(cwd));
  }
}

function makeTaskId() {
  return `task-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeApprovalToken() {
  return crypto.randomBytes(4).toString("base64url").toUpperCase();
}

function safeFileName(input) {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export function makeAtomicJsonTempPath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = makeAtomicJsonTempPath(filePath);
  await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmpPath, filePath);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function appendFile(filePath, text) {
  await ensureDir(path.dirname(filePath));
  await fsp.appendFile(filePath, text, "utf8");
}

async function readText(filePath) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractStatusHint(event) {
  const candidates = [
    event.status,
    event.phase,
    event.type,
    event.event,
    event.kind,
    event.message,
    event.text,
    event.delta,
    event.data?.status,
    event.data?.phase,
    event.data?.message,
    event.payload?.status,
    event.payload?.message,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(typeof candidate === "string" ? candidate : "");
    if (!normalized) continue;
    if (normalized.length <= 180) return normalized;
    return truncate(normalized, 180);
  }
  return undefined;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toErrorText(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function listFilesRecursive(rootDir) {
  const result = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function findNewSessionId(beforeSet, afterSet) {
  const freshFiles = [];
  for (const file of afterSet) {
    if (!beforeSet.has(file)) freshFiles.push(file);
  }
  freshFiles.sort();
  for (const file of freshFiles.reverse()) {
    const match = file.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (match) return match[0];
  }
  return null;
}

function findSessionIdInText(text) {
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] ?? null;
}

function formatElapsed(startedAt) {
  if (!startedAt) return "unknown";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "unknown";
  const totalSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function extractChangedFiles(text) {
  if (!text) return [];
  const matches = new Set();
  const patterns = [
    /`([^`\n]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?)`/g,
    /\b(?:\/|\.{0,2}\/)[^\s`]+?\.[A-Za-z0-9]+\b/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = normalizeText(match[1] ?? match[0]);
      if (!candidate) continue;
      if (candidate.length > 200) continue;
      matches.add(candidate);
      if (matches.size >= DEFAULT_MAX_CHANGED_FILES) break;
    }
  }
  return Array.from(matches);
}

function extractNextSteps(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const output = [];
  let collecting = false;
  for (const line of lines) {
    const normalizedLine = normalizeHeadingLine(line);
    if (!collecting && /^(next(?:\s+steps?)?|下一步|后续建议)\b[:：]?/i.test(normalizedLine)) {
      collecting = true;
      const cleaned = normalizedLine.replace(/^(next(?:\s+steps?)?|下一步|后续建议)\b[:：]?\s*/i, "").trim();
      if (cleaned) output.push(cleaned);
      continue;
    }
    if (!collecting) continue;
    if (!line) break;
    if (/^[-*]\s+/.test(normalizedLine)) output.push(normalizedLine.replace(/^[-*]\s+/, "").trim());
    else if (output.length > 0) break;
  }
  return uniqueStrings(output.filter(Boolean));
}

function normalizeHeadingLine(line) {
  return line.replace(/^[*_#\s`]+/, "").replace(/[*_`#\s]+$/, "").trim();
}

function uniqueStrings(items) {
  return Array.from(new Set(items));
}

function looksLikeBenignCodexWarning(line) {
  const lower = line.toLowerCase();
  return (
    lower.includes("failed to delete shell snapshot") ||
    lower.includes("proceeding, even though we could not update path") ||
    lower.includes("state db discrepancy during") ||
    lower.includes("failed to open state db")
  );
}

async function ensureSeedFile(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return;
  const sourceStat = await fsp.stat(sourcePath).catch(() => null);
  const targetStat = await fsp.stat(targetPath).catch(() => null);
  if (!sourceStat) return;
  if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) return;
  await ensureDir(path.dirname(targetPath));
  await fsp.copyFile(sourcePath, targetPath);
}
