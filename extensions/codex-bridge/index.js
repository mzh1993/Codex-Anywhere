import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { f as unregisterInternalHook, u as registerInternalHook } from "../../.runtime/openclaw-2026.3.22/node_modules/openclaw/dist/internal-hooks-D4lZfNM5.js";
import { definePluginEntry } from "../../.runtime/openclaw-2026.3.22/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js";
import {
  editMessageFeishu,
  sendCardFeishu,
  sendMediaFeishu,
  sendMessageFeishu,
  updateCardFeishu,
} from "../../.runtime/openclaw-2026.3.22/node_modules/openclaw/dist/extensions/feishu/index.js";
import { buildBridgeActionExecution } from "./lib/bridge-action-exec.js";
import { buildCodexArgs, buildCodexEnv } from "./lib/codex-exec.js";
import {
  createBridgeActionPersistence,
  createBridgeActionRecord,
} from "./lib/bridge-action-store.js";
import {
  finishBridgeActionDenied,
  finishBridgeActionFromExecution,
  finishBridgeActionWithApprovalRequired,
  startBridgeActionExecution,
} from "./lib/bridge-action-model.js";
import { handleCommandFallback } from "./lib/command-fallback-router.js";
import { isPathInsideAny } from "./lib/fs-utils.js";
import { getLocaleText, getUserVisibleStatusHint, localizeTaskStatus } from "./lib/locale.js";
import { ensureIsolatedOpenClawShim } from "./lib/openclaw-shim.js";
import {
  assessPolicyDecision,
  assessPolicyRequest,
  classifyOwnedBridgeActionRequest,
  POLICY_DECISIONS,
} from "./lib/policy.js";
import {
  parseDeliveryManifest,
  summarizeDeliveryFailures,
  validateDeclaredDeliverables,
} from "./lib/reply-plane.js";
import { detectExecutionRuntimeCompatibility } from "./lib/runtime-compatibility.js";
import { resolveSettings } from "./lib/settings.js";
import {
  classifyApprovalReply,
  createApprovalReplyContract,
  isActiveTaskStatus,
  routeResumeCommand,
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
const WINDOWS_ATOMIC_WRITE_MAX_ATTEMPTS = 6;
const WINDOWS_ATOMIC_WRITE_RETRY_BASE_MS = 25;
const STALE_ATOMIC_TEMP_MAX_AGE_MS = 10 * 60 * 1000;
const RETRYABLE_ATOMIC_WRITE_ERROR_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const ISOLATED_OPENCLAW_SCRIPT_PATH = fileURLToPath(new URL("../../scripts/openclaw-isolated.sh", import.meta.url));
const BOOTSTRAP_SCRIPT_PATH = fileURLToPath(new URL("../../scripts/bootstrap-codex-feishu.sh", import.meta.url));

const activeTasks = new Map();
export const __activeTasks = activeTasks;
const activeBridgeActions = new Map();
export const __activeBridgeActions = activeBridgeActions;
const cleanedAtomicTempDirs = new Set();

function normalizeAccessMode(value) {
  return value === "full_access" ? "full_access" : "normal";
}

function hasExplicitSafeSandboxOverride(executionOptions) {
  const sandbox = normalizeText(executionOptions?.sandbox);
  return Boolean(sandbox) && sandbox !== "danger-full-access";
}

function resolveProfileRiskLevel(profile, existingTask = null, executionOptions = null) {
  if (hasExplicitSafeSandboxOverride(executionOptions)) return "normal";
  if (existingTask?.riskLevel) return existingTask.riskLevel;
  return normalizeAccessMode(profile?.accessMode) === "full_access" ? "high" : "normal";
}

export default definePluginEntry({
  id: "codex-bridge",
  name: "Codex Bridge",
  description: "Feishu remote Codex bridge",
  register(api) {
    const bridge = new CodexBridge(api);
    const messageReceivedHook = async (event) => bridge.handleInternalMessageReceived(event);
    api.logger.warn?.("codex-bridge register: plugin loaded");
    api.logger.warn?.(`codex-bridge state root: ${bridge.settings.stateRoot}`);
    globalThis.__codexFeishuBridgeClaim = async (event, ctx) => bridge.handleInboundClaim(event, ctx);
    registerInternalHook("message:received", messageReceivedHook);
    api.on("inbound_claim", async (event, ctx) => bridge.handleInboundClaim(event, ctx));
    api.on("before_reset", async (event, ctx) => bridge.handleBeforeReset(event, ctx));
    api.on("gateway_stop", async () => {
      delete globalThis.__codexFeishuBridgeClaim;
      unregisterInternalHook("message:received", messageReceivedHook);
      await bridge.abortAll("gateway stop");
    });
  },
});

export class CodexBridge {
  constructor(api) {
    this.api = api;
    this.settings = resolveSettings(api);
    this.text = getLocaleText(this.settings.locale);
    this.openClawSessionBindings = new Map();
    this.resetAbandonedTaskIds = new Map();
    const persistence = createTaskPersistence({
      tasksRoot: this.settings.tasksRoot,
      runsRoot: this.settings.runsRoot,
      readJson,
      writeJson,
      safeFileName,
    });
    const bridgeActionPersistence = createBridgeActionPersistence({
      bridgeActionsRoot: this.settings.bridgeActionsRoot,
      readJson,
      writeJson,
      safeFileName,
    });
    this.taskStore = persistence.tasks;
    this.runStore = persistence.runs;
    this.bridgeActionStore = bridgeActionPersistence.actions;
  }

  rememberOpenClawSessionBinding(binding) {
    const sessionKey = normalizeText(binding?.sessionKey);
    const senderId = normalizeText(binding?.senderId);
    const conversationId = normalizeText(binding?.conversationId);
    const channelId = normalizeText(binding?.channelId).toLowerCase();
    if (!sessionKey || !senderId || !conversationId || channelId !== FEISHU_CHANNEL) return;
    this.openClawSessionBindings.set(sessionKey, {
      sessionKey,
      channelId,
      accountId: normalizeText(binding?.accountId) || DEFAULT_ACCOUNT_ID,
      conversationId,
      senderId,
      updatedAt: Date.now(),
    });
  }

  handleInternalMessageReceived(event) {
    const sessionKey = normalizeText(event?.sessionKey);
    const context = event?.context ?? {};
    this.rememberOpenClawSessionBinding({
      sessionKey,
      channelId: context.channelId,
      accountId: context.accountId,
      conversationId: context.conversationId,
      senderId: context.metadata?.senderId,
    });
  }

  isResetAbandonedTask(task) {
    return this.resetAbandonedTaskIds.get(task?.senderId) === task?.taskId;
  }

  clearResetAbandonedTask(task) {
    if (!task) return;
    if (this.resetAbandonedTaskIds.get(task.senderId) === task.taskId) {
      this.resetAbandonedTaskIds.delete(task.senderId);
    }
  }

  async handleBeforeReset(event, ctx) {
    const sessionKey = normalizeText(ctx?.sessionKey);
    if (!sessionKey) return;

    const binding = this.openClawSessionBindings.get(sessionKey);
    if (!binding) return;

    const profile = await this.loadProfile(binding.senderId, null);
    if (!profile) return;
    if (normalizeText(profile.conversationId) && normalizeText(profile.conversationId) !== binding.conversationId) return;
    if (normalizeText(profile.accountId) && normalizeText(profile.accountId) !== binding.accountId) return;

    let profileChanged = false;
    if (normalizeAccessMode(profile.accessMode) !== "normal") {
      delete profile.accessMode;
      profileChanged = true;
    }

    const activeTask = await this.loadActiveTask(binding.senderId, profile);
    if (!activeTask) {
      if (profileChanged) {
        profile.updatedAt = new Date().toISOString();
        await this.saveProfile(profile);
      }
      return;
    }

    const reason = formatUpstreamResetReason(event?.reason);
    if (activeTask.status === "running") {
      this.resetAbandonedTaskIds.set(activeTask.senderId, activeTask.taskId);
      if (profile.activeTaskId === activeTask.taskId) delete profile.activeTaskId;
      if (profile.pendingApprovalToken === activeTask.approvalToken) delete profile.pendingApprovalToken;
      profile.lastTaskId = activeTask.taskId;
      profile.updatedAt = new Date().toISOString();
      await this.saveProfile(profile);
      await this.stopTask(activeTask, reason);
      return;
    }

    await this.finalizeStoredTask(activeTask, profile, {
      status: "aborted",
      error: reason,
    });
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
    const paired = await this.isSenderPaired(accountId, senderId);
    if (!paired) {
      this.api.logger.info?.(`codex-bridge inbound_claim: decline (sender not paired sender=${senderId} account=${accountId})`);
      return;
    }

    const legacyTopLevelCommand = getClosedLegacyTopLevelCommand(text);
    if (legacyTopLevelCommand) {
      this.api.logger.info?.(`codex-bridge inbound_claim: closed legacy top-level command ${JSON.stringify(legacyTopLevelCommand)}`);
      const profile = await this.loadProfile(senderId, null);
      const cwd = profile?.defaultCwd || this.settings.defaultCwd;
      await this.safeReply({
        accountId,
        conversationId,
        messageId,
        renderHint: "help",
        text: this.text.unknownCommand(legacyTopLevelCommand, cwd),
      });
      return { handled: true };
    }

    if (shouldBypassClaim(text)) {
      this.api.logger.info?.(`codex-bridge inbound_claim: bypass command ${JSON.stringify(truncate(text, 80))}`);
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
      ensureDir(this.settings.bridgeActionsRoot),
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

    const malformedCodexCommand = extractMalformedCodexCommand(request.text);
    if (malformedCodexCommand) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.malformedCodexCommand(malformedCodexCommand),
      });
      return;
    }

    const activeTask = await this.loadActiveTask(profile.senderId, profile);
    const activeBridgeAction = await this.loadActiveBridgeAction(profile.senderId, profile);
    if (activeBridgeAction?.status === "awaiting_approval") {
      await this.handleBridgeActionApprovalReply(profile, request, activeBridgeAction);
      return;
    }
    if (activeTask?.status === "awaiting_approval") {
      await this.handleApprovalReply(profile, request, activeTask);
      return;
    }

    const ownedBridgeAction = classifyOwnedBridgeActionRequest({
      prompt: request.text,
      bridgeServiceUnitNames: this.settings.bridgeServiceUnitNames,
    });
    if (ownedBridgeAction) {
      if (activeTask?.status === "running") {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.bridgeActionBlockedByRunningTask,
        });
        return;
      }
      if (activeBridgeAction?.status === "running") {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.bridgeActionAlreadyRunning,
        });
        return;
      }
      await this.queueOrExecuteBridgeAction({
        ...ownedBridgeAction,
        profile,
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        cwd: profile.defaultCwd || this.settings.defaultCwd,
        senderName: request.senderName,
        requestText: request.text,
      });
      return;
    }

    if (activeTask) {
      const routeResult = routeIncomingPlainText({
        activeTaskStatus: activeTask.status,
        activeTaskOwner: activeTask.owner,
        requiresExplicitContinue: activeTask.requiresExplicitContinue,
      });
      if (routeResult.action === "handle_approval_reply") {
        await this.handleApprovalReply(profile, request, activeTask);
        return;
      }
      if (routeResult.action === "continue_task") {
        await this.queueOrStartTask({
          entrySurface: "plain_text",
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
      entrySurface: "plain_text",
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

    const nativeInvocation = parseNativeCodexInvocation(request.text);
    if (nativeInvocation) {
      if (nativeInvocation.error) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.formatNativeInvocationError(nativeInvocation.error),
        });
        return;
      }
      await this.handleNativeCodexInvocation(profile, request, nativeInvocation);
      return;
    }

    await handleCommandFallback({
      bridge: this,
      profile,
      request,
      parsed,
    });
  }

  async handleNativeCodexInvocation(profile, request, invocation) {
    if (invocation.mode === "resume") {
      if (!invocation.prompt) {
        await this.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: this.text.usageNativeResume,
        });
        return;
      }
      const activeTask = await this.loadActiveTask(profile.senderId, profile);
      const resumeRoute = routeResumeCommand({ activeTaskStatus: activeTask?.status ?? null });
      if (!resumeRoute.accepted) {
        if (activeTask) {
          await this.safeReply({
            accountId: request.accountId,
            conversationId: request.conversationId,
            messageId: request.messageId,
            text: this.text.taskAlreadyRunning({
              taskId: activeTask.taskId,
              status: activeTask.status,
              code: resumeRoute.code,
              suggestedCommand: resumeRoute.suggestedCommand,
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
        entrySurface: "explicit_codex_command",
        profile,
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        mode: this.getNextRunMode(activeTask),
        prompt: invocation.prompt,
        cwd: activeTask.cwd,
        senderName: request.senderName,
        existingTask: activeTask,
        executionOptions: invocation.executionOptions,
      });
      return;
    }

    if (!invocation.prompt) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.usageNativeNew,
      });
      return;
    }

    const activeTask = await this.loadActiveTask(profile.senderId, profile);
    const explicitNewPrep = await this.prepareForExplicitNewTask(profile, activeTask);
    if (!explicitNewPrep.ok) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.taskAlreadyRunning({
          taskId: activeTask.taskId,
          status: activeTask.status,
          code: "active_task_exists",
          ...(activeTask?.status === "awaiting_input" ? { suggestedCommand: "/codex resume <prompt>" } : {}),
        }),
      });
      return;
    }

    await this.queueOrStartTask({
      entrySurface: "explicit_codex_command",
      profile,
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      mode: "new",
      prompt: invocation.prompt,
      cwd: invocation.cwd ?? (profile.defaultCwd || this.settings.defaultCwd),
      senderName: request.senderName,
      executionOptions: invocation.executionOptions,
    });
  }

  async prepareForExplicitNewTask(profile, activeTask) {
    if (!activeTask) return { ok: true };
    if (activeTask.status === "awaiting_input" || activeTask.status === "awaiting_approval") {
      await this.finalizeStoredTask(activeTask, profile, {
        status: "aborted",
        error: "superseded by explicit new task",
      });
      return { ok: true };
    }
    return { ok: false, activeTask };
  }

  formatNativeInvocationError(error) {
    if (!error) return this.text.help(this.settings.defaultCwd);
    if (error.kind === "missing_value") {
      const usageText = error.usage === "resume" ? this.text.usageNativeResume : this.text.usageNativeNew;
      return this.text.nativeOptionMissingValue(error.option, usageText);
    }
    if (error.kind === "invalid_value") {
      return this.text.nativeOptionInvalidValue(error.option, error.value, error.allowedValues ?? []);
    }
    if (error.kind === "unknown_option") {
      return this.text.nativeUnknownOption(error.option);
    }
    return this.text.help(this.settings.defaultCwd);
  }

  async sendHelp(request, profile) {
    const cwd = profile.defaultCwd || this.settings.defaultCwd;
    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      renderHint: "help",
      text: this.text.help(cwd),
    });
  }

  async sendUnknownCommand(request, commandName) {
    const profile = await this.loadProfile(request.senderId, null);
    const cwd = profile?.defaultCwd || this.settings.defaultCwd;
    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      renderHint: "help",
      text: this.text.unknownCommand(`/codex ${commandName}`, cwd),
    });
  }

  async queueOrExecuteBridgeAction(params) {
    const timestamp = new Date().toISOString();
    const actionId = makeBridgeActionId();
    const baseAction = createBridgeActionRecord({
      actionId,
      locale: this.settings.locale,
      senderId: params.profile.senderId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      cwd: params.cwd,
      kind: params.kind,
      operation: params.operation,
      target: params.target,
      requestText: params.requestText ?? params.prompt ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    params.profile.activeBridgeActionId = actionId;
    params.profile.lastBridgeActionId = actionId;
    params.profile.updatedAt = timestamp;
    await this.saveProfile(params.profile);

    if (params.requiresApproval) {
      const token = makeApprovalToken();
      const transition = finishBridgeActionWithApprovalRequired();
      const action = createBridgeActionRecord({
        ...baseAction,
        status: transition.status,
        owner: transition.owner,
        resultStatus: transition.resultStatus,
        approvalToken: token,
      });
      await this.saveBridgeAction(action);
      await this.writeApproval({
        token,
        kind: "bridge_action",
        actionId,
        senderId: params.profile.senderId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        reasonCodes: params.reasonCodes ?? [],
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + this.settings.approvalTtlMs,
      });
      await this.safeReply({
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        renderHint: "approval",
        text: this.text.bridgeActionApprovalQueued({
          token,
          reasons: params.reasonCodes ?? [],
        }),
      });
      return;
    }

    const transition = startBridgeActionExecution();
    const action = createBridgeActionRecord({
      ...baseAction,
      status: transition.status,
      owner: transition.owner,
      resultStatus: transition.resultStatus,
    });
    await this.saveBridgeAction(action);
    activeBridgeActions.set(params.profile.senderId, { actionId: action.actionId });
    await this.executeAndFinishBridgeAction(action, params.profile, requestMessageTarget(params));
  }

  async approvePendingBridgeActionRequest(profile, request, token) {
    const approval = await this.readApproval(token);
    if (!approval || approval.kind !== "bridge_action") {
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
      const action = approval.actionId ? await this.readBridgeAction(approval.actionId) : null;
      if (action) {
        await this.finishBridgeAction(action, profile, {
          resultStatus: "failed",
          error: "approval token expired",
          recoveryTrace: {
            reason: "bridge_action_approval_expired",
          },
        });
      }
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenExpired(token),
      });
      return;
    }

    const action = approval.actionId ? await this.readBridgeAction(approval.actionId) : null;
    if (!action) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenNotFound(token),
      });
      return;
    }

    await this.deleteApproval(token);
    const transition = startBridgeActionExecution();
    const nextAction = createBridgeActionRecord({
      ...action,
      status: transition.status,
      owner: transition.owner,
      resultStatus: transition.resultStatus,
      approvalToken: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.saveBridgeAction(nextAction);
    activeBridgeActions.set(profile.senderId, { actionId: nextAction.actionId });
    await this.executeAndFinishBridgeAction(nextAction, profile, request);
  }

  async handleBridgeActionApprovalReply(profile, request, action) {
    if (!action.approvalToken) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.noPendingApproval,
      });
      return;
    }

    const approval = await this.readApproval(action.approvalToken);
    if (!approval || approval.kind !== "bridge_action") {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.noPendingApproval,
      });
      return;
    }

    const decision = classifyApprovalReply({
      text: request.text,
      replyContract: approval.replyContract,
    });

    if (decision.outcome === "approve") {
      await this.approvePendingBridgeActionRequest(profile, request, approval.token);
      return;
    }
    if (decision.outcome === "approve_with_tail") {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.bridgeActionApprovalNeedsPureApprove,
      });
      return;
    }
    if (decision.outcome === "deny") {
      await this.denyPendingBridgeAction(profile, request, action, approval);
      return;
    }

    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      renderHint: "approval",
      text: this.text.bridgeActionApprovalStillPending({
        token: approval.token,
        reasons: approval.reasonCodes ?? [],
      }),
    });
  }

  async denyPendingBridgeAction(profile, request, action, approval) {
    await this.deleteApproval(approval.token);
    await this.finishBridgeAction(action, profile, {
      resultStatus: finishBridgeActionDenied().resultStatus,
      error: null,
    });
    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: this.text.bridgeActionDenied,
    });
  }

  async executeAndFinishBridgeAction(action, profile, request) {
    let plannedExecutionTrace = null;
    try {
      const plannedExecution = buildBridgeActionExecution(action, {
        isolatedOpenClawScriptPath: ISOLATED_OPENCLAW_SCRIPT_PATH,
        bootstrapScriptPath: BOOTSTRAP_SCRIPT_PATH,
      });
      plannedExecutionTrace = {
        executor: action.contract?.executor ?? null,
        command: plannedExecution.command,
        args: plannedExecution.args,
        exitCode: null,
      };
    } catch {}

    let result;
    try {
      result = await this.executeBridgeAction(action);
    } catch (error) {
      result = {
        exitCode: 1,
        error: toErrorText(error),
        summary: "",
        executionTrace: action.trace?.execution ?? plannedExecutionTrace,
      };
    }
    const finished = await this.finishBridgeAction(action, profile, {
      resultStatus: finishBridgeActionFromExecution(result).resultStatus,
      error: result.error ?? null,
      summary: result.summary ?? "",
      executionTrace:
        result.executionTrace ??
        (plannedExecutionTrace
          ? {
              ...plannedExecutionTrace,
              exitCode: result.exitCode ?? plannedExecutionTrace.exitCode,
            }
          : null),
    });
    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: this.text.bridgeActionFinished({
        summary: finished.resultText,
        resultStatus: finished.resultStatus,
        error: finished.error,
      }),
    });
  }

  async approvePendingRequest(profile, request, token, options = {}) {
    const promptOverride = options.promptOverride ?? null;
    const promptTail = options.promptTail ?? null;
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
    if (approval.approvalGrant?.consumedAtMs != null) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalTokenConsumed(token),
      });
      return;
    }

    await this.writeApproval(approval);

    const promptCheck = this.checkApprovalPromptBoundary({
      approval,
      promptOverride,
      promptTail,
    });
    if (!promptCheck.ok) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: promptCheck.replyText,
      });
      return;
    }

    const runtimeCheck = await this.ensureExecutionRuntimeReady();
    if (!runtimeCheck.ok) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.executionRuntimeUnavailable(runtimeCheck.message),
      });
      return;
    }

    const existingTask = approval.taskId ? await this.readTask(approval.taskId) : null;
    const nextRun = startNextRunFromApproval();

    await this.startTask({
      profile,
      accountId: approval.accountId,
      conversationId: approval.conversationId,
      messageId: approval.messageId,
      mode: approval.sessionId ? "resume" : approval.mode,
      prompt: promptCheck.prompt,
      cwd: approval.cwd,
      sessionId: approval.sessionId,
      policyDecision: approval.policyDecision ?? POLICY_DECISIONS.APPROVAL_REQUIRED,
      reasonCodes: approval.reasonCodes ?? approval.riskReasons ?? [],
      riskLevel: "high",
      executionOptions: approval.executionOptions ?? existingTask?.executionOptions ?? null,
      approvalToken: null,
      status: nextRun.taskStatus,
      existingTask,
      runtimeCheck,
    });

    approval.approvalGrant = {
      ...(approval.approvalGrant ?? {}),
      consumedAtMs: Date.now(),
    };
    await this.writeApproval(approval);
    await this.deleteApproval(token);
    if (profile.pendingApprovalToken === token) delete profile.pendingApprovalToken;
    profile.accessMode = "full_access";
    await this.saveProfile(profile);
  }

  async handleApprovalReply(profile, request, task) {
    if (!task.approvalToken) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.noPendingApproval,
      });
      return;
    }

    const approval = await this.readApproval(task.approvalToken);
    if (!approval) {
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.noPendingApproval,
      });
      return;
    }

    const decision = classifyApprovalReply({
      text: request.text,
      replyContract: approval.replyContract,
    });

    if (decision.outcome === "approve") {
      await this.approvePendingRequest(profile, request, approval.token);
      return;
    }

    if (decision.outcome === "approve_with_tail") {
      await this.approvePendingRequest(profile, request, approval.token, {
        promptOverride: mergeApprovalPrompt(approval.prompt, decision.tail),
        promptTail: decision.tail,
      });
      return;
    }

    if (decision.outcome === "deny") {
      await this.denyPendingRequest(profile, request, task, approval);
      return;
    }

    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      renderHint: "approval",
      text: this.text.approvalStillPending({
        token: approval.token,
        reasons: approval.reasonCodes ?? [],
      }),
    });
  }

  async denyPendingRequest(profile, request, task, approval) {
    const onDeny = approval.onDeny ?? "await_user_replan";
    if (onDeny === "abort_task") {
      await this.finalizeStoredTask(task, profile, {
        status: "aborted",
        error: "approval denied by user",
      });
      await this.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: this.text.approvalDeniedTaskAborted,
      });
      return;
    }

    await this.deleteApproval(approval.token);
    const timestamp = new Date().toISOString();
    task.status = "awaiting_input";
    task.owner = "codex";
    task.currentRunId = null;
    task.approvalToken = null;
    task.finishedAt = null;
    task.updatedAt = timestamp;
    task.error = null;
    await this.saveTask(task);

    if (profile.pendingApprovalToken === approval.token) delete profile.pendingApprovalToken;
    profile.activeTaskId = task.taskId;
    profile.lastTaskId = task.taskId;
    profile.updatedAt = timestamp;
    await this.saveProfile(profile);

    await this.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: this.text.approvalDeniedAwaitingReplan,
    });
  }

  checkApprovalPromptBoundary({ approval, promptOverride, promptTail }) {
    const approvedPrompt = normalizeText(approval?.prompt);
    const effectivePrompt = normalizeText(promptOverride) || approvedPrompt;
    if (!effectivePrompt) {
      return {
        ok: true,
        prompt: effectivePrompt,
      };
    }

    const approvedReasonCodes = normalizeReasonCodes(approval?.reasonCodes ?? approval?.riskReasons ?? []);
    const mergedDecision = assessPolicyDecision({
      prompt: effectivePrompt,
      cwd: approval?.cwd,
      protectedRoots: this.settings.policyProtectedRoots,
      isolationBoundaryRoots: this.settings.isolationBoundaryRoots,
      hostCodexRoot: this.settings.hostCodexRoot,
    });
    const normalizedMergedDecision = applyRuntimeModePolicyDecision(mergedDecision, this.settings.runtimeMode);

    if (normalizedMergedDecision.kind === POLICY_DECISIONS.DENIED) {
      return {
        ok: false,
        replyText: [
          this.text.requestRejected(normalizedMergedDecision.reasonCodes ?? []),
          "",
          this.text.approvalStillPending({
            token: approval.token,
            reasons: approvedReasonCodes,
          }),
        ].join("\n"),
      };
    }

    const normalizedTail = normalizeText(promptTail);
    if (promptOverride && normalizedTail) {
      const tailDecision = assessPolicyDecision({
        prompt: normalizedTail,
        cwd: approval?.cwd,
        protectedRoots: this.settings.policyProtectedRoots,
        isolationBoundaryRoots: this.settings.isolationBoundaryRoots,
        hostCodexRoot: this.settings.hostCodexRoot,
      });
      const normalizedTailDecision = applyRuntimeModePolicyDecision(tailDecision, this.settings.runtimeMode);
      if (normalizedTailDecision.kind !== POLICY_DECISIONS.ALLOWED) {
        return {
          ok: false,
          replyText:
            normalizedTailDecision.kind === POLICY_DECISIONS.DENIED
              ? [
                  this.text.requestRejected(normalizedTailDecision.reasonCodes ?? []),
                  "",
                  this.text.approvalStillPending({
                    token: approval.token,
                    reasons: approvedReasonCodes,
                  }),
                ].join("\n")
              : this.text.approvalTailScopeChanged({
                  token: approval.token,
                  reasons: approvedReasonCodes,
                }),
        };
      }

      const ownedBridgeAction = classifyOwnedBridgeActionRequest({
        prompt: normalizedTail,
        bridgeServiceUnitNames: this.settings.bridgeServiceUnitNames,
      });
      if (ownedBridgeAction) {
        return {
          ok: false,
          replyText: this.text.approvalTailScopeChanged({
            token: approval.token,
            reasons: approvedReasonCodes,
          }),
        };
      }
    }

    const grantComparisonPrompt = promptOverride && normalizedTail ? approval?.prompt : effectivePrompt;
    const grantCheck = this.checkApprovalGrantBoundary({
      approval,
      prompt: grantComparisonPrompt,
    });
    if (!grantCheck.ok) return grantCheck;

    return {
      ok: true,
      prompt: effectivePrompt,
    };
  }

  checkApprovalGrantBoundary({ approval, prompt }) {
    const grant = approval?.approvalGrant;
    if (!grant || !prompt) {
      return {
        ok: true,
      };
    }

    const currentGrant = buildApprovalGrantSummary({
      approval: {
        ...approval,
        prompt,
      },
      settings: this.settings,
      preserveExistingGrant: false,
    });
    if (approvalGrantEquivalent(grant, currentGrant)) {
      return {
        ok: true,
      };
    }

    const approvedReasonCodes = normalizeReasonCodes(approval?.reasonCodes ?? approval?.riskReasons ?? []);
    return {
      ok: false,
      replyText: this.text.approvalGrantScopeChanged({
        token: approval.token,
        reasons: approvedReasonCodes,
      }),
    };
  }

  async queueOrStartTask(params) {
    await this.clearRememberedFullAccessForExplicitSafeSandbox(params.profile, {
      entrySurface: params.entrySurface,
      executionOptions: params.executionOptions,
    });

    const cwd = expandUserPath(params.cwd, this.settings.defaultCwd);
    await assertAllowedCwd(cwd, this.settings);
    const decision = resolveStartEntryDecision({
      entrySurface: params.entrySurface,
      prompt: params.prompt,
      cwd,
      executionOptions: params.executionOptions,
      protectedRoots: this.settings.policyProtectedRoots,
      isolationBoundaryRoots: this.settings.isolationBoundaryRoots,
      hostCodexRoot: this.settings.hostCodexRoot,
      runtimeMode: this.settings.runtimeMode,
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
        executionOptions: params.executionOptions ?? null,
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
        executionOptions: params.executionOptions ?? null,
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
        executionOptions: params.executionOptions ?? null,
        policyDecision: decision.kind,
        reasonCodes,
        replyContract: createApprovalReplyContract(),
        onDeny: "await_user_replan",
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
        renderHint: "approval",
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
      riskLevel: resolveProfileRiskLevel(params.profile, params.existingTask, params.executionOptions),
    });
  }

  async clearRememberedFullAccessForExplicitSafeSandbox(profile, { entrySurface, executionOptions } = {}) {
    if (normalizeEntrySurface(entrySurface) !== "explicit_codex_command") return;
    if (normalizeAccessMode(profile?.accessMode) !== "full_access") return;
    if (!hasExplicitSafeSandboxOverride(executionOptions)) return;
    delete profile.accessMode;
    profile.updatedAt = new Date().toISOString();
    await this.saveProfile(profile);
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
      executionOptions: params.executionOptions ?? params.existingTask.executionOptions ?? null,
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
      executionOptions: params.executionOptions ?? params.existingTask.executionOptions ?? null,
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
      executionOptions: params.executionOptions ?? params.existingTask.executionOptions ?? null,
      policyDecision: decision.kind,
      reasonCodes: decision.reasonCodes ?? [],
      replyContract: createApprovalReplyContract(),
      onDeny: "await_user_replan",
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
      renderHint: "approval",
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

    const runtimeCheck = params.runtimeCheck ?? (await this.ensureExecutionRuntimeReady());
    if (!runtimeCheck.ok) {
      await this.safeReply({
        accountId: params.accountId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        text: this.text.executionRuntimeUnavailable(runtimeCheck.message),
      });
      return;
    }

    const cwd = await resolveExistingCwd(
      params.cwd,
      params.profile.defaultCwd || this.settings.defaultCwd,
      this.api.logger,
    );
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
      cwd,
      mode: params.mode,
      sessionId: params.sessionId ?? params.existingTask?.sessionId ?? null,
      status: "running",
      currentRunId: runId,
      lastRunId: runId,
      riskLevel: params.riskLevel ?? resolveProfileRiskLevel(params.profile, params.existingTask, params.executionOptions),
      executionOptions: params.executionOptions ?? params.existingTask?.executionOptions ?? null,
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
      progressMessageId: null,
      lastHeartbeatBucket: null,
      lastHeartbeatVisibleHint: null,
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
      cwd,
      mode: params.mode,
      sessionId: task.sessionId,
      status: "running",
      riskLevel: task.riskLevel,
      executionOptions: task.executionOptions ?? null,
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
    let child;
    try {
      child = spawn(this.settings.codexBin, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const persisted = applyRunResultToPersistence({
        task,
        run,
        result: {
          exitCode: null,
          signal: null,
          error: toErrorText(error),
        },
        summary: null,
        changedFiles: [],
        nextSteps: [],
      });
      const nextTask = persisted.task;
      const nextRun = persisted.run;
      await this.saveTask(nextTask);
      await this.saveRun(nextRun);
      if (isActiveTaskStatus(nextTask.status)) params.profile.activeTaskId = nextTask.taskId;
      else if (params.profile.activeTaskId === nextTask.taskId) delete params.profile.activeTaskId;
      if (nextTask.sessionId) params.profile.lastSessionId = nextTask.sessionId;
      params.profile.lastTaskId = nextTask.taskId;
      params.profile.updatedAt = new Date().toISOString();
      await this.saveProfile(params.profile);
      await this.safeReply({
        accountId: nextTask.accountId,
        conversationId: nextTask.conversationId,
        renderHint: "task_finished",
        text: this.text.taskFinished({ ...nextTask, runStatus: nextRun.status }),
      });
      return;
    }

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

    await this.upsertProgressReply(task, {
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      renderHint: "task_started",
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
        if (getUserVisibleStatusHint(this.settings.locale, hint)) {
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
    const visibleHint = getUserVisibleStatusHint(this.settings.locale, hint);
    if (!visibleHint) return;
    const now = Date.now();
    if (normalizeText(task.lastStatusSentHint) === visibleHint) return;
    if (
      normalizeText(task.lastHeartbeatVisibleHint) === compactHeartbeatVisibleHint(visibleHint) &&
      Date.parse(task.startedAt) > 0 &&
      now - task.lastHeartbeatAtMs < resolveHeartbeatIntervalMs(this.settings.heartbeatMs, now - Date.parse(task.startedAt))
    ) {
      return;
    }
    if (now - task.lastStatusSentAtMs < this.settings.statusThrottleMs) return;
    task.lastStatusSentAtMs = now;
    task.lastStatusSentHint = visibleHint;
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);
    await this.upsertProgressReply(task, {
      accountId: task.accountId,
      conversationId: task.conversationId,
      messageId: task.messageId,
      renderHint: "task_progress",
      text: this.text.taskProgress(task.taskId, hint),
    });
  }

  async maybeSendHeartbeat(senderId) {
    try {
      const runtime = activeTasks.get(senderId);
      if (!runtime) return;
      const now = Date.now();
      const elapsedMs = now - Date.parse(runtime.task.startedAt);
      const heartbeatIntervalMs = resolveHeartbeatIntervalMs(this.settings.heartbeatMs, elapsedMs);
      if (now - runtime.task.lastHeartbeatAtMs < heartbeatIntervalMs) return;
      const elapsed = formatElapsed(runtime.task.startedAt);
      const visibleHint = getUserVisibleStatusHint(this.settings.locale, runtime.task.lastStatusHint);
      const compactVisibleHint = compactHeartbeatVisibleHint(visibleHint);
      runtime.task.lastHeartbeatAtMs = now;
      const heartbeatBucket = resolveHeartbeatBucket(elapsedMs);
      runtime.task.lastHeartbeatBucket = heartbeatBucket;
      runtime.task.lastHeartbeatVisibleHint = compactVisibleHint;
      runtime.task.updatedAt = new Date().toISOString();
      await this.saveTask(runtime.task);
      const suffix = compactVisibleHint ? `\n${this.text.lastLabel}: ${compactVisibleHint}` : "";
      await this.upsertProgressReply(runtime.task, {
        accountId: runtime.task.accountId,
        conversationId: runtime.task.conversationId,
        messageId: runtime.task.messageId,
        renderHint: "task_running",
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
      const abandonedByReset = this.isResetAbandonedTask(task);
      if (runtime.stdoutBuffer) await appendFile(run.stdoutLogPath, runtime.stdoutBuffer);
      if (runtime.stderrBuffer) await appendFile(run.stderrLogPath, runtime.stderrBuffer);

      if (!task.sessionId) {
        const snapshot = await this.snapshotSessionFiles();
        const candidate = findNewSessionId(run.beforeSessions, snapshot);
        if (candidate) task.sessionId = candidate;
      }
      if (task.sessionId) {
        if (abandonedByReset) {
          run.sessionId = task.sessionId;
        } else {
          await this.onTaskSessionResolved(task);
        }
      }

      const lastMessage = await readText(run.lastMessagePath);
      const parsedManifest = parseDeliveryManifest(lastMessage);
      if (parsedManifest.errorCode) {
        this.api.logger.warn?.(`codex-bridge reply-plane manifest ignored: ${parsedManifest.errorCode}`);
      }
      const finalSummary = extractSummarySection(lastMessage) ?? parsedManifest.manifest?.summary ?? null;
      const changedFiles = extractChangedFiles(lastMessage);
      const nextSteps = extractNextSteps(lastMessage);
      const validatedDeliverables = await validateDeclaredDeliverables({
        cwd: task.cwd,
        deliverables: parsedManifest.manifest?.deliverables ?? [],
      });
      const initialDeliveryFailureHint =
        summarizeDeliveryFailures({
          locale: task.locale ?? this.settings.locale,
          failures: validatedDeliverables.failures,
        }) || null;
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
        deliverables: [],
        deliveryFailureHint: initialDeliveryFailureHint,
        sessionId: task.sessionId ?? run.sessionId ?? null,
        preserveTaskContinuity:
          runtime.stopping && !abandonedByReset && shouldPreserveTaskContinuityAfterStop(task.error),
        interruptionHint:
          runtime.stopping && !abandonedByReset && shouldPreserveTaskContinuityAfterStop(task.error)
            ? inferRecoveredInterruptionHint(task, this.settings)
            : null,
      });
      const nextTask = persisted.task;
      const nextRun = persisted.run;
      await this.saveTask(nextTask);
      await this.saveRun(nextRun);

      if (!abandonedByReset) {
        const profile = await this.loadProfile(senderId, null);
        if (profile) {
          if (isActiveTaskStatus(nextTask.status)) profile.activeTaskId = nextTask.taskId;
          else if (profile.activeTaskId === nextTask.taskId) delete profile.activeTaskId;
          if (nextTask.sessionId) profile.lastSessionId = nextTask.sessionId;
          profile.lastTaskId = nextTask.taskId;
          profile.updatedAt = new Date().toISOString();
          await this.saveProfile(profile);
        }
      }

      activeTasks.delete(senderId);
      this.clearResetAbandonedTask(task);
      if (!abandonedByReset) {
        if (shouldPreserveTaskContinuityAfterStop(task.error) && runtime.stopping) {
          await this.replyOnTaskCard(nextTask, {
            accountId: nextTask.accountId,
            conversationId: nextTask.conversationId,
            text: this.text.interruptedTaskRequiresContinue(nextTask.taskId, nextTask.lastStatusHint),
          });
        } else {
          await this.replyOnTaskCard(nextTask, {
            accountId: nextTask.accountId,
            conversationId: nextTask.conversationId,
            renderHint: "task_finished",
            text: this.text.taskFinished({ ...nextTask, runStatus: nextRun.status }),
          });
          if (validatedDeliverables.accepted.length > 0) {
            const deliveryResult = await this.deliverReplyPlaneDeliverables(nextTask, validatedDeliverables.accepted);
            const combinedFailures = [...validatedDeliverables.failures, ...deliveryResult.failures];
            nextTask.deliverables = deliveryResult.delivered;
            nextRun.deliverables = deliveryResult.delivered;
            nextTask.deliveryFailureHint =
              summarizeDeliveryFailures({
                locale: nextTask.locale ?? this.settings.locale,
                failures: combinedFailures,
              }) || null;
            nextRun.deliveryFailureHint = nextTask.deliveryFailureHint;
            nextTask.updatedAt = new Date().toISOString();
            nextRun.updatedAt = nextTask.updatedAt;
            await this.saveTask(nextTask);
            await this.saveRun(nextRun);
            if (deliveryResult.failures.length > 0) {
              await this.replyOnTaskCard(nextTask, {
                accountId: nextTask.accountId,
                conversationId: nextTask.conversationId,
                renderHint: "task_finished",
                text: this.text.taskFinished({ ...nextTask, runStatus: nextRun.status }),
              });
            }
          }
        }
      }
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

  async formatStatus(senderId, profileFallback = null) {
    const activeTask = await this.loadActiveTask(senderId);
    const activeBridgeAction = await this.loadActiveBridgeAction(senderId, profileFallback);
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
      if (activeBridgeAction) lines.push(this.text.bridgeActionLine(activeBridgeAction.status));
      const visibleHint = getUserVisibleStatusHint(this.settings.locale, activeTask.lastStatusHint);
      if (visibleHint) lines.push(this.text.lastLine(visibleHint));
      return lines.join("\n");
    }

    if (activeBridgeAction) {
      const lines = [this.text.bridgeActionLine(activeBridgeAction.status)];
      if (activeBridgeAction.approvalToken) lines.push(this.text.pendingApprovalLine(activeBridgeAction.approvalToken));
      return lines.join("\n");
    }

    const profile = (await this.loadProfile(senderId, null)) ?? profileFallback;
    if (!profile) return this.text.noBridgeState;
    const lines = [
      this.text.noActiveTask,
      this.text.cwdLine(profile.defaultCwd || this.settings.defaultCwd),
      this.text.accessModeLine(profile.accessMode === "full_access" ? "full_access" : "normal"),
    ];
    if (profile.lastTaskId) lines.push(this.text.lastTaskIdLine(profile.lastTaskId));
    if (profile.lastSessionId) lines.push(this.text.lastSessionIdLine(profile.lastSessionId));
    if (profile.pendingApprovalToken) lines.push(this.text.pendingApprovalLine(profile.pendingApprovalToken));
    return lines.join("\n");
  }

  async formatDoctor(senderId, profileFallback = null) {
    const activeTask = await this.loadActiveTask(senderId);
    const activeBridgeAction = await this.loadActiveBridgeAction(senderId, profileFallback);

    const codex =
      activeTask?.status != null ? localizeTaskStatus(this.settings.locale, activeTask.status) : doctorIdleLabel(this.settings.locale);
    const bridge =
      activeBridgeAction?.status != null
        ? localizeTaskStatus(this.settings.locale, activeBridgeAction.status)
        : doctorBridgeOkLabel(this.settings.locale);
    const runtime = await this.probeExecutionRuntimeForDoctor();
    const gatewayProbe = await this.probeGatewayHealthForDoctor(profileFallback);
    const gateway = typeof gatewayProbe === "string" ? gatewayProbe : gatewayProbe?.label ?? doctorGatewayErrorLabel(this.settings.locale);
    const gatewayOk = typeof gatewayProbe === "string" ? gatewayProbe === doctorGatewayOkLabel(this.settings.locale) : Boolean(gatewayProbe?.ok);
    const feishu = await this.probeFeishuRuntimeForDoctor();
    const nextStep = resolveDoctorNextStep(this.settings.locale, {
      activeTaskStatus: activeTask?.status ?? null,
      runtimeOk: runtime.ok,
      gatewayOk,
      feishuReady: feishu.ok,
    });

    return this.text.doctorSummary({
      codex,
      bridge,
      runtime: runtime.label,
      codexVersion: runtime.codexVersion,
      bwrapVersion: runtime.bwrapVersion,
      feishu: feishu.label,
      gateway,
      runtimeMessage: runtime.message,
      nextStep,
    });
  }

  async probeExecutionRuntimeForDoctor() {
    try {
      const runtime = await this.ensureExecutionRuntimeReady();
      return {
        ok: Boolean(runtime?.ok),
        label: runtime?.ok ? doctorRuntimeOkLabel(this.settings.locale) : doctorRuntimeErrorLabel(this.settings.locale),
        codexVersion: runtime?.codexVersion ?? doctorUnknownValue(this.settings.locale),
        bwrapVersion: runtime?.bwrapVersion ?? doctorUnknownValue(this.settings.locale),
        message: runtime?.ok ? null : runtime?.message ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        label: doctorRuntimeErrorLabel(this.settings.locale),
        codexVersion: doctorUnknownValue(this.settings.locale),
        bwrapVersion: doctorUnknownValue(this.settings.locale),
        message: toErrorText(error),
      };
    }
  }

  async probeGatewayHealthForDoctor(profileFallback = null) {
    if (this.settings.runtimeMode === "native_windows_fast" || process.platform === "win32") {
      const config = this.api.runtime.config.loadConfig?.() ?? this.api.config ?? {};
      const configuredPort = Number.parseInt(String(config?.gateway?.port ?? ""), 10);
      const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 19789;
      const ok = await probeTcpLoopbackPort(port);
      return ok ? doctorGatewayOkLabel(this.settings.locale) : doctorGatewayErrorLabel(this.settings.locale);
    }
    try {
      const profile = profileFallback ?? null;
      const result = await this.executeBridgeAction({
        kind: "gateway_health",
        operation: "check",
        target: "gateway",
        cwd: profile?.defaultCwd || this.settings.defaultCwd,
      });
      if (!result?.error && (result?.exitCode ?? 0) === 0) {
        return doctorGatewayOkLabel(this.settings.locale);
      }
      return doctorGatewayErrorLabel(this.settings.locale);
    } catch {
      return doctorGatewayErrorLabel(this.settings.locale);
    }
  }

  async probeFeishuRuntimeForDoctor() {
    const envReady =
      normalizeText(process.env.CODEX_FEISHU_APP_ID).length > 0 &&
      normalizeText(process.env.CODEX_FEISHU_APP_SECRET).length > 0;
    const secretsEnvPath = path.join(path.dirname(this.settings.stateRoot), "openclaw-codex-feishu.secrets.env");
    const ok = envReady || fs.existsSync(secretsEnvPath);
    return {
      ok,
      label: ok ? doctorFeishuReadyLabel(this.settings.locale) : doctorFeishuMissingLabel(this.settings.locale),
    };
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
      const prepared = this.prepareReply(params);
      const updateMessageId = normalizeText(prepared.updateMessageId);
      if (updateMessageId) {
        try {
          if (prepared.card) {
            await updateCardFeishu({
              cfg,
              accountId: prepared.accountId,
              messageId: updateMessageId,
              card: prepared.card,
            });
          } else {
            await editMessageFeishu({
              cfg,
              accountId: prepared.accountId,
              messageId: updateMessageId,
              text: prepared.text,
            });
          }
          return { messageId: updateMessageId, updated: true };
        } catch (error) {
          this.api.logger.warn?.(`codex-bridge reply update failed: ${toErrorText(error)}; fallback to new reply`);
        }
      }
      if (prepared.card) {
        return await sendCardFeishu({
          cfg,
          accountId: prepared.accountId,
          to: prepared.conversationId,
          replyToMessageId: prepared.messageId || undefined,
          card: prepared.card,
        });
      }
      return await sendMessageFeishu({
        cfg,
        accountId: prepared.accountId,
        to: prepared.conversationId,
        replyToMessageId: prepared.messageId || undefined,
        text: prepared.text,
      });
    } catch (error) {
      this.api.logger.error(`codex-bridge reply failed: ${toErrorText(error)}`);
      return null;
    }
  }

  async sendNativeMediaReply(params) {
    const cfg = this.api.runtime.config.loadConfig();
    return await sendMediaFeishu({
      cfg,
      accountId: params.accountId,
      to: params.conversationId,
      replyToMessageId: params.messageId || undefined,
      mediaUrl: params.filePath,
      mediaLocalRoots: [params.cwd ?? path.dirname(params.filePath)],
    });
  }

  async sendNativeTextReply(params) {
    const cfg = this.api.runtime.config.loadConfig();
    return await sendMessageFeishu({
      cfg,
      accountId: params.accountId,
      to: params.conversationId,
      replyToMessageId: params.messageId || undefined,
      text: params.text,
    });
  }

  async deliverReplyPlaneDeliverables(task, deliverables) {
    const delivered = [];
    const failures = [];
    for (const deliverable of Array.isArray(deliverables) ? deliverables : []) {
      try {
        if (deliverable.kind === "link") {
          await this.sendNativeTextReply({
            accountId: task.accountId,
            conversationId: task.conversationId,
            messageId: task.messageId,
            text: formatReplyPlaneLinkText(deliverable),
          });
        } else {
          await this.sendNativeMediaReply({
            accountId: task.accountId,
            conversationId: task.conversationId,
            messageId: task.messageId,
            cwd: task.cwd,
            filePath: deliverable.resolvedPath,
          });
        }
        delivered.push(toPersistedDeliverable(deliverable));
      } catch (error) {
        this.api.logger.warn?.(`codex-bridge reply-plane delivery failed: ${toErrorText(error)}`);
        failures.push({
          ...deliverable,
          code: "upload_failed",
        });
      }
    }
    return { delivered, failures };
  }

  async upsertProgressReply(task, reply) {
    const progressMessageId = normalizeText(task.progressMessageId);
    const result = await this.safeReply({
      ...reply,
      ...(progressMessageId ? { updateMessageId: progressMessageId, messageId: undefined } : {}),
    });
    const resolvedMessageId = normalizeText(result?.messageId ?? "");
    if (resolvedMessageId && task.progressMessageId !== resolvedMessageId) {
      task.progressMessageId = resolvedMessageId;
      task.updatedAt = new Date().toISOString();
      await this.saveTask(task);
    }
  }

  async replyOnTaskCard(task, reply) {
    const progressMessageId = normalizeText(task.progressMessageId);
    return await this.safeReply({
      ...reply,
      ...(progressMessageId ? { updateMessageId: progressMessageId } : {}),
    });
  }

  prepareReply(params) {
    if (params.card || !params.renderHint || !params.text) return params;
    return {
      ...params,
      card: buildBridgePresentationCard({
        locale: this.settings.locale,
        renderHint: params.renderHint,
        text: params.text,
      }),
      text: undefined,
    };
  }

  async executeBridgeAction(action) {
    const execution = buildBridgeActionExecution(action, {
      isolatedOpenClawScriptPath: ISOLATED_OPENCLAW_SCRIPT_PATH,
      bootstrapScriptPath: BOOTSTRAP_SCRIPT_PATH,
    });
    const result = await runCommandCapture(execution.command, execution.args, { cwd: action.cwd });
    return {
      ...result,
      executionTrace: {
        executor: action.contract?.executor ?? null,
        command: execution.command,
        args: execution.args,
        exitCode: result.exitCode ?? null,
      },
    };
  }

  async ensureCodexHome() {
    await ensureDir(this.settings.codexHome);
    await ensureDir(path.join(this.settings.codexHome, "sessions"));
    await ensureSeedFile(this.settings.authJsonPath, path.join(this.settings.codexHome, "auth.json"));
    await ensureSeedFile(this.settings.configTomlPath, path.join(this.settings.codexHome, "config.toml"));
    await ensureIsolatedOpenClawShim({
      codexHome: this.settings.codexHome,
      isolatedCliPath: ISOLATED_OPENCLAW_SCRIPT_PATH,
    });
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
    const task = await this.taskStore.read(taskId);
    return task ? createTaskRecord(task) : null;
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

  async readBridgeAction(actionId) {
    const action = await this.bridgeActionStore.read(actionId);
    return action ? createBridgeActionRecord(action) : null;
  }

  async saveBridgeAction(action) {
    await this.bridgeActionStore.write(action);
  }

  async readApproval(token) {
    const approval = await readJson(this.approvalPath(token), null);
    if (!approval) return null;
    return this.normalizeApprovalRecord(approval);
  }

  async writeApproval(approval) {
    await writeJson(this.approvalPath(approval.token), this.normalizeApprovalRecord(approval));
  }

  async deleteApproval(token) {
    await fsp.rm(this.approvalPath(token), { force: true });
  }

  normalizeApprovalRecord(approval) {
    const fallbackGrant = buildApprovalGrantSummary({
      approval,
      settings: this.settings,
      preserveExistingGrant: false,
    });
    const normalizedApproval = {
      ...approval,
      reasonCodes: normalizeReasonCodes(approval?.reasonCodes ?? approval?.riskReasons ?? []),
      replyContract: createApprovalReplyContract(approval?.replyContract ?? {}),
      onDeny: approval?.onDeny ?? "await_user_replan",
    };
    return {
      ...normalizedApproval,
      approvalGrant: normalizeApprovalGrantSummary(normalizedApproval?.approvalGrant, fallbackGrant),
    };
  }

  async loadActiveTask(senderId, profile = null) {
    const liveTask = this.getActiveTask(senderId);
    if (liveTask) {
      if (this.isResetAbandonedTask(liveTask)) return null;
      return liveTask;
    }

    const currentProfile = profile ?? (await this.loadProfile(senderId, null));
    const profileActiveTaskId = normalizeText(currentProfile?.activeTaskId);
    const profileLastTaskId = normalizeText(currentProfile?.lastTaskId);
    let candidateTaskId = profileActiveTaskId;
    let recoveredFromLastTask = false;
    if (!candidateTaskId && profileLastTaskId) {
      candidateTaskId = profileLastTaskId;
      recoveredFromLastTask = true;
    }
    if (!candidateTaskId) return null;

    let task = await this.readTask(candidateTaskId);
    if (!task) {
      if (profileActiveTaskId) delete currentProfile.activeTaskId;
      if (recoveredFromLastTask) delete currentProfile.lastTaskId;
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
          interruptionHint: inferRecoveredInterruptionHint(task, this.settings),
        });
        task = recovered.task;
        await this.saveTask(task);
        if (recovered.run) await this.saveRun(recovered.run);
      }

    if (isActiveTaskStatus(task.status)) {
      if (recoveredFromLastTask && currentProfile.activeTaskId !== task.taskId) {
        currentProfile.activeTaskId = task.taskId;
        currentProfile.lastTaskId = task.taskId;
        currentProfile.updatedAt = new Date().toISOString();
        await this.saveProfile(currentProfile);
      }
      return task;
    }

    if (currentProfile.activeTaskId === task.taskId) delete currentProfile.activeTaskId;
    if (currentProfile.pendingApprovalToken === task.approvalToken) {
      delete currentProfile.pendingApprovalToken;
    }
    currentProfile.updatedAt = new Date().toISOString();
    await this.saveProfile(currentProfile);
    return null;
  }

  async loadActiveBridgeAction(senderId, profile = null) {
    const currentProfile = profile ?? (await this.loadProfile(senderId, null));
    if (!currentProfile?.activeBridgeActionId) return null;

    const action = await this.readBridgeAction(currentProfile.activeBridgeActionId);
    if (!action) {
      delete currentProfile.activeBridgeActionId;
      currentProfile.updatedAt = new Date().toISOString();
      await this.saveProfile(currentProfile);
      return null;
    }

    if (action.status === "finished") {
      delete currentProfile.activeBridgeActionId;
      currentProfile.lastBridgeActionId = action.actionId;
      currentProfile.updatedAt = new Date().toISOString();
      await this.saveProfile(currentProfile);
      return null;
    }

    if (action.status === "running") {
      const activeRuntime = activeBridgeActions.get(senderId);
      if (activeRuntime?.actionId === action.actionId) return action;
      await this.finishBridgeAction(action, currentProfile, {
        resultStatus: "failed",
        error: "bridge action interrupted before completion",
        recoveryTrace: {
          reason: "bridge_action_interrupted_before_completion",
        },
      });
      return null;
    }

    if (action.status === "awaiting_approval" && action.approvalToken) {
      const approval = await this.readApproval(action.approvalToken);
      if (!approval || Date.now() > approval.expiresAtMs) {
        if (approval) await this.deleteApproval(action.approvalToken);
        await this.finishBridgeAction(action, currentProfile, {
          resultStatus: "failed",
          error: "approval token expired",
          recoveryTrace: {
            reason: "bridge_action_approval_expired",
          },
        });
        return null;
      }
    }

    return action;
  }

  async finishBridgeAction(action, profile, result = {}) {
    const timestamp = new Date().toISOString();
    const nextAction = createBridgeActionRecord({
      ...action,
      ...finishBridgeActionFromExecution({
        exitCode: result.resultStatus === "failed" ? 1 : 0,
        error: result.error ?? null,
      }),
      approvalToken: null,
      resultStatus: result.resultStatus ?? finishBridgeActionFromExecution({}).resultStatus,
      resultText: result.summary ?? action.resultText ?? null,
      error: result.error ?? null,
      trace: {
        execution: result.executionTrace ?? action.trace?.execution ?? null,
        recovery: result.recoveryTrace ?? action.trace?.recovery ?? null,
      },
      finishedAt: timestamp,
      updatedAt: timestamp,
    });
    await this.saveBridgeAction(nextAction);

    const activeRuntime = activeBridgeActions.get(action.senderId);
    if (activeRuntime?.actionId === action.actionId) {
      activeBridgeActions.delete(action.senderId);
    }
    const currentProfile = profile ?? (await this.loadProfile(action.senderId, null));
    if (currentProfile) {
      if (currentProfile.activeBridgeActionId === action.actionId) delete currentProfile.activeBridgeActionId;
      currentProfile.lastBridgeActionId = action.actionId;
      currentProfile.updatedAt = timestamp;
      await this.saveProfile(currentProfile);
    }
    return nextAction;
  }

  async finalizeStoredTask(task, profile, result) {
    const previousApprovalToken = task.approvalToken;
    if (previousApprovalToken) {
      await this.deleteApproval(previousApprovalToken);
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
    task.owner = "codex";
    task.currentRunId = null;
    task.approvalToken = null;
    task.error = result.error ?? task.error;
    task.finishedAt = timestamp;
    task.updatedAt = timestamp;
    await this.saveTask(task);

    if (profile.activeTaskId === task.taskId) delete profile.activeTaskId;
    if (profile.pendingApprovalToken === previousApprovalToken) delete profile.pendingApprovalToken;
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

  async ensureExecutionRuntimeReady() {
    return detectExecutionRuntimeCompatibility({
      codexBin: this.settings.codexBin,
      runtimeMode: this.settings.runtimeMode,
    });
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
      interruptionHint: inferRecoveredInterruptionHint(runtime.task, this.settings),
    });

    await this.persistRecoveredRuntimeState(runtime, recovered, error);

    await this.safeReply({
      accountId: runtime.task.accountId,
      conversationId: runtime.task.conversationId,
      messageId: runtime.task.messageId,
      text: this.text.interruptedTaskRequiresContinue(runtime.task.taskId, recovered.task.lastStatusHint),
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

async function probeTcpLoopbackPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(value);
    };
    socket.setTimeout(1200);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
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

function parseNativeCodexInvocation(text) {
  const normalized = normalizeText(text);
  if (!normalized?.startsWith("/codex")) return null;
  const rest = normalized.slice("/codex".length).trim();
  if (!rest) return null;

  const tokens = splitCommandTokens(rest);
  if (tokens.length === 0) return null;

  let index = 0;
  let mode = "new";
  if (tokens[0].toLowerCase() === "resume") {
    mode = "resume";
    index = 1;
  } else if (!tokens[0].startsWith("-")) {
    return null;
  }

  let cwd = null;
  const executionOptions = {};

  while (index < tokens.length) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (lower === "--cd" || token === "-C") {
      if (mode === "resume") {
        return createNativeInvocationError("unknown_option", { option: token });
      }
      const nextValue = tokens[index + 1];
      if (!nextValue) {
        return createNativeInvocationError("missing_value", {
          option: token,
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      cwd = nextValue;
      index += 2;
      continue;
    }
    if (lower.startsWith("--cd=")) {
      if (mode === "resume") {
        return createNativeInvocationError("unknown_option", { option: "--cd" });
      }
      cwd = token.slice(token.indexOf("=") + 1);
      if (!cwd) {
        return createNativeInvocationError("missing_value", {
          option: "--cd",
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      index += 1;
      continue;
    }
    if (lower === "--model" || token === "-m") {
      const nextValue = tokens[index + 1];
      if (!nextValue) {
        return createNativeInvocationError("missing_value", {
          option: token,
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      executionOptions.model = nextValue;
      index += 2;
      continue;
    }
    if (lower.startsWith("--model=")) {
      executionOptions.model = token.slice(token.indexOf("=") + 1);
      if (!executionOptions.model) {
        return createNativeInvocationError("missing_value", {
          option: "--model",
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      index += 1;
      continue;
    }
    if (lower === "--reasoning") {
      const nextValue = tokens[index + 1];
      if (!nextValue) {
        return createNativeInvocationError("missing_value", {
          option: token,
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_REASONING_VALUES.includes(nextValue)) {
        return createNativeInvocationError("invalid_value", {
          option: token,
          value: nextValue,
          allowedValues: NATIVE_REASONING_VALUES,
        });
      }
      executionOptions.reasoningEffort = nextValue;
      index += 2;
      continue;
    }
    if (lower.startsWith("--reasoning=")) {
      executionOptions.reasoningEffort = token.slice(token.indexOf("=") + 1);
      if (!executionOptions.reasoningEffort) {
        return createNativeInvocationError("missing_value", {
          option: "--reasoning",
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_REASONING_VALUES.includes(executionOptions.reasoningEffort)) {
        return createNativeInvocationError("invalid_value", {
          option: "--reasoning",
          value: executionOptions.reasoningEffort,
          allowedValues: NATIVE_REASONING_VALUES,
        });
      }
      index += 1;
      continue;
    }
    if (lower === "--sandbox" || token === "-s") {
      const nextValue = tokens[index + 1];
      if (!nextValue) {
        return createNativeInvocationError("missing_value", {
          option: token,
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_SANDBOX_VALUES.includes(nextValue)) {
        return createNativeInvocationError("invalid_value", {
          option: token,
          value: nextValue,
          allowedValues: NATIVE_SANDBOX_VALUES,
        });
      }
      executionOptions.sandbox = nextValue;
      index += 2;
      continue;
    }
    if (lower.startsWith("--sandbox=")) {
      executionOptions.sandbox = token.slice(token.indexOf("=") + 1);
      if (!executionOptions.sandbox) {
        return createNativeInvocationError("missing_value", {
          option: "--sandbox",
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_SANDBOX_VALUES.includes(executionOptions.sandbox)) {
        return createNativeInvocationError("invalid_value", {
          option: "--sandbox",
          value: executionOptions.sandbox,
          allowedValues: NATIVE_SANDBOX_VALUES,
        });
      }
      index += 1;
      continue;
    }
    if (lower === "--ask-for-approval" || token === "-a") {
      const nextValue = tokens[index + 1];
      if (!nextValue) {
        return createNativeInvocationError("missing_value", {
          option: token,
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_APPROVAL_VALUES.includes(nextValue)) {
        return createNativeInvocationError("invalid_value", {
          option: token,
          value: nextValue,
          allowedValues: NATIVE_APPROVAL_VALUES,
        });
      }
      executionOptions.askForApproval = nextValue;
      index += 2;
      continue;
    }
    if (lower.startsWith("--ask-for-approval=")) {
      executionOptions.askForApproval = token.slice(token.indexOf("=") + 1);
      if (!executionOptions.askForApproval) {
        return createNativeInvocationError("missing_value", {
          option: "--ask-for-approval",
          usage: mode === "resume" ? "resume" : "new",
        });
      }
      if (!NATIVE_APPROVAL_VALUES.includes(executionOptions.askForApproval)) {
        return createNativeInvocationError("invalid_value", {
          option: "--ask-for-approval",
          value: executionOptions.askForApproval,
          allowedValues: NATIVE_APPROVAL_VALUES,
        });
      }
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      return createNativeInvocationError("unknown_option", { option: token });
    }
    break;
  }

  if (mode === "new" && !cwd && Object.keys(executionOptions).length === 0) return null;

  const prompt = tokens.slice(index).join(" ").trim();
  return {
    mode,
    cwd: cwd ? cwd : null,
    executionOptions: Object.fromEntries(Object.entries(executionOptions).filter(([, value]) => value)),
    prompt,
  };
}

const NATIVE_REASONING_VALUES = Object.freeze(["none", "low", "medium", "high", "xhigh"]);
const NATIVE_SANDBOX_VALUES = Object.freeze(["read-only", "workspace-write", "danger-full-access"]);
const NATIVE_APPROVAL_VALUES = Object.freeze(["untrusted", "on-failure", "on-request", "never"]);

function createNativeInvocationError(kind, detail) {
  return {
    error: {
      kind,
      ...detail,
    },
  };
}

function splitCommandTokens(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && index + 1 < input.length) {
        const next = input[index + 1];
        if (next === quote || next === "\\") {
          current += next;
          index += 1;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (char === "\\" && index + 1 < input.length) {
      const next = input[index + 1];
      // Keep Windows paths intact (C:\Users\...) while still allowing escaped whitespace and quotes.
      if (/\s/.test(next) || next === '"' || next === "'" || next === "\\") {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function mergeApprovalPrompt(prompt, tail) {
  const base = normalizeText(prompt);
  const extra = normalizeText(tail);
  if (!base) return extra ?? "";
  if (!extra) return base;
  return `${base}\n\n补充要求：${extra}`;
}

function normalizeReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes)) return [];
  return Array.from(
    new Set(
      reasonCodes
        .map((reasonCode) => normalizeText(typeof reasonCode === "string" ? reasonCode : ""))
        .filter(Boolean),
    ),
  ).sort();
}

function buildApprovalGrantSummary({ approval, settings, preserveExistingGrant = true }) {
  if (!approval?.token) return null;
  const assessment = assessPolicyRequest({
    prompt: approval.prompt,
    cwd: approval.cwd,
    protectedRoots: settings.policyProtectedRoots,
    isolationBoundaryRoots: settings.isolationBoundaryRoots,
    hostCodexRoot: settings.hostCodexRoot,
  });
  return {
    grantType: "codex_task_run",
    taskId: approval.taskId ?? null,
    approvalToken: approval.token,
    decisionKind: approval.policyDecision ?? assessment.decision.kind,
    action: assessment.action,
    reasonCodes: normalizeReasonCodes(
      approval.reasonCodes ?? approval.riskReasons ?? assessment.decision.reasonCodes ?? [],
    ),
    intent: assessment.intent,
    promptDigest: createApprovalPromptDigest(approval.prompt),
    executionBoundaries: assessment.executionBoundaries,
    effects: assessment.effects,
    createdAtMs:
      preserveExistingGrant && approval.approvalGrant?.createdAtMs != null
        ? approval.approvalGrant.createdAtMs
        : approval.createdAtMs ?? Date.now(),
    expiresAtMs:
      preserveExistingGrant && Number.isFinite(approval.approvalGrant?.expiresAtMs)
        ? approval.approvalGrant.expiresAtMs
        : approval.expiresAtMs ?? null,
    consumedAtMs: preserveExistingGrant ? approval.approvalGrant?.consumedAtMs ?? null : null,
  };
}

function normalizeApprovalGrantSummary(grant, fallbackGrant) {
  if (!fallbackGrant) return null;
  if (!grant || typeof grant !== "object") return fallbackGrant;
  return {
    grantType:
      normalizeText(typeof grant.grantType === "string" ? grant.grantType : "") || fallbackGrant.grantType,
    taskId: normalizeText(typeof grant.taskId === "string" ? grant.taskId : "") || fallbackGrant.taskId,
    approvalToken:
      normalizeText(typeof grant.approvalToken === "string" ? grant.approvalToken : "") || fallbackGrant.approvalToken,
    decisionKind:
      normalizeText(typeof grant.decisionKind === "string" ? grant.decisionKind : "") || fallbackGrant.decisionKind,
    action: normalizeText(typeof grant.action === "string" ? grant.action : "") || fallbackGrant.action,
    reasonCodes: normalizeReasonCodes(grant.reasonCodes ?? fallbackGrant.reasonCodes),
    intent: normalizeText(typeof grant.intent === "string" ? grant.intent : "") || fallbackGrant.intent,
    promptDigest:
      normalizeText(typeof grant.promptDigest === "string" ? grant.promptDigest : "") || fallbackGrant.promptDigest,
    executionBoundaries: normalizeApprovalGrantObject(grant.executionBoundaries, fallbackGrant.executionBoundaries),
    effects: normalizeApprovalGrantObject(grant.effects, fallbackGrant.effects),
    createdAtMs: Number.isFinite(grant.createdAtMs) ? grant.createdAtMs : fallbackGrant.createdAtMs,
    expiresAtMs: Number.isFinite(grant.expiresAtMs) ? grant.expiresAtMs : fallbackGrant.expiresAtMs,
    consumedAtMs: Number.isFinite(grant.consumedAtMs) ? grant.consumedAtMs : null,
  };
}

function normalizeApprovalGrantObject(value, fallbackValue) {
  if (!fallbackValue || typeof fallbackValue !== "object") return fallbackValue ?? null;
  if (!value || typeof value !== "object") return { ...fallbackValue };
  return Object.fromEntries(
    Object.keys(fallbackValue).map((key) => {
      const fallbackEntry = fallbackValue[key];
      const valueEntry = value[key];
      if (fallbackEntry && typeof fallbackEntry === "object" && !Array.isArray(fallbackEntry)) {
        return [key, normalizeApprovalGrantObject(valueEntry, fallbackEntry)];
      }
      if (typeof fallbackEntry === "boolean") {
        return [key, typeof valueEntry === "boolean" ? valueEntry : fallbackEntry];
      }
      return [key, valueEntry ?? fallbackEntry];
    }),
  );
}

function approvalGrantEquivalent(left, right) {
  if (!left || !right) return left === right;
  return JSON.stringify(approvalGrantValidationSummary(left)) === JSON.stringify(approvalGrantValidationSummary(right));
}

function approvalGrantValidationSummary(grant) {
  return {
    grantType: grant.grantType ?? null,
    taskId: grant.taskId ?? null,
    approvalToken: grant.approvalToken ?? null,
    decisionKind: grant.decisionKind ?? null,
    action: grant.action ?? null,
    reasonCodes: normalizeReasonCodes(grant.reasonCodes),
    intent: grant.intent ?? null,
    promptDigest: grant.promptDigest ?? null,
    executionBoundaries: normalizeApprovalGrantObject(grant.executionBoundaries, grant.executionBoundaries ?? {}),
    effects: normalizeApprovalGrantObject(grant.effects, grant.effects ?? {}),
  };
}

function createApprovalPromptDigest(prompt) {
  return crypto.createHash("sha256").update(normalizeText(prompt)).digest("hex");
}

function requestMessageTarget(params) {
  return {
    accountId: params.accountId,
    conversationId: params.conversationId,
    messageId: params.messageId,
  };
}

function toPersistedDeliverable(deliverable) {
  return {
    kind: normalizeText(deliverable?.kind).toLowerCase(),
    path: normalizeText(deliverable?.path),
    url: normalizeText(deliverable?.url),
    note: normalizeText(deliverable?.note),
  };
}

function formatReplyPlaneLinkText(deliverable) {
  const note = normalizeText(deliverable?.note);
  const url = normalizeText(deliverable?.url);
  if (note) return `${note}\n${url}`;
  return url;
}

function buildBridgePresentationCard({ locale, renderHint, text }) {
  const normalizedLocale = /^zh(?:[-_].*)?$/i.test(normalizeText(locale)) ? "zh-CN" : "en-US";
  const cardMeta = resolveBridgeCardMeta(normalizedLocale, renderHint);
  const approvalActions = renderHint === "approval" ? buildApprovalCardActions(normalizedLocale) : null;
  const markdownText = renderHint === "approval" ? approvalCardWarningText(normalizedLocale) : text;
  const elements = [
    {
      tag: "markdown",
      content: markdownText,
    },
    ...(approvalActions
      ? [
          {
            tag: "action",
            actions: approvalActions,
            layout: "bisected",
          },
        ]
      : []),
  ];
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: cardMeta.template,
      title: {
        tag: "plain_text",
        content: cardMeta.title,
      },
    },
    elements,
  };
}

function buildApprovalCardActions(locale) {
  const isZh = locale === "zh-CN";
  const approveLabel = isZh ? "同意" : "Approve";
  const denyLabel = isZh ? "不要执行" : "Do Not Run";
  const approveCommand = isZh ? "同意" : "approve";
  const denyCommand = isZh ? "不要执行" : "do not run";
  return [
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: approveLabel,
      },
      type: "primary",
      value: {
        command: approveCommand,
      },
    },
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: denyLabel,
      },
      type: "danger",
      value: {
        command: denyCommand,
      },
    },
  ];
}

function approvalCardWarningText(locale) {
  if (locale === "zh-CN") return "⚠️ 高风险操作，请确认。";
  return "⚠️ High-risk operation. Please confirm.";
}

function resolveBridgeCardMeta(locale, renderHint) {
  const zh = locale === "zh-CN";
  switch (renderHint) {
    case "help":
      return { title: zh ? "Codex" : "Codex", template: "blue" };
    case "doctor":
      return { title: zh ? "健康摘要" : "Health Summary", template: "blue" };
    case "approval":
      return { title: zh ? "等待确认" : "Approval Needed", template: "orange" };
    case "task_started":
      return { title: zh ? "任务已启动" : "Task Started", template: "indigo" };
    case "task_progress":
      return { title: zh ? "执行中" : "Running", template: "turquoise" };
    case "task_running":
      return { title: zh ? "执行中" : "Running", template: "turquoise" };
    case "task_finished":
      return { title: zh ? "本轮结果" : "Run Result", template: "green" };
    default:
      return { title: zh ? "Codex" : "Codex", template: "blue" };
  }
}

function inferRecoveredInterruptionHint(task, settings) {
  const prompt = normalizeText(task?.prompt)?.toLowerCase() ?? "";
  if (!prompt) return "run.interrupted";
  const reasonCodes = Array.isArray(task?.reasonCodes) ? task.reasonCodes : [];
  if (!reasonCodes.includes("service_control_requires_approval")) return "run.interrupted";
  const bridgeServiceUnitNames = Array.isArray(settings?.bridgeServiceUnitNames) ? settings.bridgeServiceUnitNames : [];
  const normalizedUnits = bridgeServiceUnitNames
    .map((unit) => normalizeText(unit)?.toLowerCase() ?? "")
    .filter(Boolean);
  if (normalizedUnits.some((unit) => prompt.includes(unit))) {
    return "run.interrupted.bridge_self_restart";
  }
  return "run.interrupted";
}

function shouldPreserveTaskContinuityAfterStop(reason) {
  return normalizeText(reason) === "gateway stop";
}

function isCodexCommand(text) {
  return normalizeText(text)?.startsWith("/codex") ?? false;
}

function extractMalformedCodexCommand(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^(?:[:：]\s*)+(\/codex(?:\s.*)?$)/i);
  return match?.[1]?.trim() ?? null;
}

function shouldBypassClaim(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (!normalized.startsWith("/")) return false;
  return !normalized.startsWith("/codex");
}

function getClosedLegacyTopLevelCommand(text) {
  const normalized = normalizeText(text);
  if (!normalized.startsWith("/")) return null;
  if (/^\/new(?:\s|$)/i.test(normalized)) return "/new";
  if (/^\/reset(?:\s|$)/i.test(normalized)) return "/reset";
  return null;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function formatUpstreamResetReason(reason) {
  const normalizedReason = normalizeText(reason);
  return normalizedReason ? `upstream session reset: ${normalizedReason}` : "upstream session reset";
}

function assessNativeExecutionDecision(executionOptions) {
  const reasonCodes = [];
  if (executionOptions?.sandbox === "danger-full-access") {
    reasonCodes.push("native_dangerous_sandbox_requires_approval");
  }
  if (executionOptions?.askForApproval === "never") {
    reasonCodes.push("native_never_approval_requires_approval");
  }
  return {
    kind: reasonCodes.length > 0 ? POLICY_DECISIONS.APPROVAL_REQUIRED : POLICY_DECISIONS.ALLOWED,
    reasonCodes,
  };
}

function resolveStartEntryDecision({
  entrySurface,
  prompt,
  cwd,
  executionOptions,
  protectedRoots,
  isolationBoundaryRoots,
  hostCodexRoot,
  runtimeMode,
}) {
  if (normalizeEntrySurface(entrySurface) === "plain_text") {
    return {
      kind: POLICY_DECISIONS.ALLOWED,
      reasonCodes: [],
    };
  }

  const promptDecision = assessPolicyDecision({
    prompt,
    cwd,
    protectedRoots,
    isolationBoundaryRoots,
    hostCodexRoot,
  });
  const nativeDecision = assessNativeExecutionDecision(executionOptions);
  const mergedDecision = mergePolicyDecisionKinds(promptDecision, nativeDecision);
  return applyRuntimeModePolicyDecision(mergedDecision, runtimeMode);
}

function normalizeEntrySurface(entrySurface) {
  if (entrySurface === "plain_text") return "plain_text";
  if (entrySurface === "approval_granted_run") return "approval_granted_run";
  return "explicit_codex_command";
}

function mergePolicyDecisionKinds(primary, secondary) {
  const primaryReasonCodes = Array.isArray(primary?.reasonCodes) ? primary.reasonCodes : [];
  const secondaryReasonCodes = Array.isArray(secondary?.reasonCodes) ? secondary.reasonCodes : [];
  const reasonCodes = Array.from(new Set([...primaryReasonCodes, ...secondaryReasonCodes]));

  if (primary?.kind === POLICY_DECISIONS.DENIED || secondary?.kind === POLICY_DECISIONS.DENIED) {
    return {
      kind: POLICY_DECISIONS.DENIED,
      reasonCodes,
    };
  }
  if (primary?.kind === POLICY_DECISIONS.APPROVAL_REQUIRED || secondary?.kind === POLICY_DECISIONS.APPROVAL_REQUIRED) {
    return {
      kind: POLICY_DECISIONS.APPROVAL_REQUIRED,
      reasonCodes,
    };
  }
  return {
    kind: POLICY_DECISIONS.ALLOWED,
    reasonCodes,
  };
}

function applyRuntimeModePolicyDecision(decision, runtimeMode) {
  if (normalizeRuntimeMode(runtimeMode) !== "native_windows_fast") return decision;
  if (decision?.kind !== POLICY_DECISIONS.APPROVAL_REQUIRED) return decision;
  return {
    kind: POLICY_DECISIONS.ALLOWED,
    reasonCodes: [],
  };
}

function normalizeRuntimeMode(value) {
  if (value === "native_windows_fast") return "native_windows_fast";
  return "secure_linux";
}

function doctorIdleLabel(locale) {
  return locale === "zh-CN" ? "空闲" : "idle";
}

function doctorBridgeOkLabel(locale) {
  return locale === "zh-CN" ? "正常" : "ok";
}

function doctorRuntimeOkLabel(locale) {
  return locale === "zh-CN" ? "正常" : "ok";
}

function doctorRuntimeErrorLabel(locale) {
  return locale === "zh-CN" ? "异常" : "unhealthy";
}

function doctorGatewayOkLabel(locale) {
  return locale === "zh-CN" ? "正常" : "ok";
}

function doctorGatewayErrorLabel(locale) {
  return locale === "zh-CN" ? "异常" : "unhealthy";
}

function doctorFeishuReadyLabel(locale) {
  return locale === "zh-CN" ? "已就绪" : "ready";
}

function doctorFeishuMissingLabel(locale) {
  return locale === "zh-CN" ? "未就绪" : "missing";
}

function doctorUnknownValue(locale) {
  return locale === "zh-CN" ? "未知" : "unknown";
}

function resolveDoctorNextStep(locale, input) {
  const activeTaskStatus =
    typeof input === "string" || input == null ? (input ?? null) : (input.activeTaskStatus ?? null);
  const runtimeOk = typeof input === "object" && input != null ? input.runtimeOk !== false : true;
  const gatewayOk = typeof input === "object" && input != null ? input.gatewayOk !== false : true;
  const feishuReady = typeof input === "object" && input != null ? input.feishuReady !== false : true;

  if (locale === "zh-CN") {
    if (!runtimeOk) return "先修复 Codex / bwrap 执行环境，再重试显式 `/codex ...`。";
    if (!feishuReady) return "先补齐隔离 Feishu 凭据，再重试。";
    if (!gatewayOk) return "先恢复 gateway 连通性，再重试。";
    if (activeTaskStatus === "running") return "等待当前任务完成。";
    if (activeTaskStatus === "awaiting_approval") return "先处理当前审批，再继续后续动作。";
    if (activeTaskStatus === "awaiting_input") return "直接回复下一步给 Codex。";
    return "直接发送普通消息给 Codex。";
  }
  if (!runtimeOk) return "Fix the Codex / bwrap runtime, then retry an explicit `/codex ...` start.";
  if (!feishuReady) return "Restore the isolated Feishu credentials, then retry.";
  if (!gatewayOk) return "Restore gateway connectivity, then retry.";
  if (activeTaskStatus === "running") return "Wait for the current task to finish.";
  if (activeTaskStatus === "awaiting_approval") return "Handle the current approval first.";
  if (activeTaskStatus === "awaiting_input") return "Reply directly with the next step for Codex.";
  return "Send a plain message to Codex.";
}

function expandUserPath(input, baseDir) {
  const normalized = normalizeText(input);
  if (!normalized) return baseDir;
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  if (path.isAbsolute(normalized)) return path.normalize(normalized);
  return path.resolve(baseDir, normalized);
}

async function assertAllowedCwd(cwd, settings) {
  if (isPathInsideAny(cwd, settings.isolationBoundaryRoots)) {
    throw new Error(getLocaleText(settings.locale).cwdBlocked(cwd));
  }
}

export async function resolveExistingCwd(candidateCwd, fallbackCwd, logger) {
  const fallback = expandUserPath(fallbackCwd, fallbackCwd);
  const preferred = expandUserPath(candidateCwd, fallback);
  if (await isExistingDirectory(preferred)) return preferred;
  if (preferred !== fallback) {
    logger?.warn?.(`codex-bridge cwd fallback: requested cwd missing (${preferred}); using ${fallback}`);
  }
  if (!(await isExistingDirectory(fallback))) {
    await ensureDir(fallback);
  }
  return fallback;
}

function makeTaskId() {
  return `task-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeBridgeActionId() {
  return `action-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
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

async function isExistingDirectory(dirPath) {
  try {
    const stat = await fsp.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function makeAtomicJsonTempPath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await cleanupStaleAtomicTempsOnce(path.dirname(filePath));
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const maxAttempts = process.platform === "win32" ? WINDOWS_ATOMIC_WRITE_MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tmpPath = makeAtomicJsonTempPath(filePath);
    try {
      await fsp.writeFile(tmpPath, payload, "utf8");
      await fsp.rename(tmpPath, filePath);
      return;
    } catch (error) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      if (attempt >= maxAttempts || !isRetryableAtomicWriteError(error)) {
        throw withAtomicWriteContext(error, { filePath, attempt, maxAttempts });
      }
      await sleep(getAtomicWriteRetryDelayMs(attempt));
    }
  }
}

async function cleanupStaleAtomicTempsOnce(dirPath) {
  if (cleanedAtomicTempDirs.has(dirPath)) return;
  cleanedAtomicTempDirs.add(dirPath);
  try {
    const now = Date.now();
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.json\..+\.tmp$/i.test(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (!stat) continue;
      if (now - stat.mtimeMs < STALE_ATOMIC_TEMP_MAX_AGE_MS) continue;
      await fsp.rm(fullPath, { force: true }).catch(() => {});
    }
  } catch {
    // best effort
  }
}

function isRetryableAtomicWriteError(error) {
  const code = normalizeText(error?.code ?? "");
  return RETRYABLE_ATOMIC_WRITE_ERROR_CODES.has(code);
}

function getAtomicWriteRetryDelayMs(attempt) {
  const exp = Math.min(Math.max(0, Number(attempt) - 1), 5);
  const jitter = Math.floor(Math.random() * 15);
  return WINDOWS_ATOMIC_WRITE_RETRY_BASE_MS * 2 ** exp + jitter;
}

function withAtomicWriteContext(error, context) {
  const details = `atomic write failed for ${context.filePath} (attempt ${context.attempt}/${context.maxAttempts})`;
  const wrapped = new Error(`${toErrorText(error)}; ${details}`);
  if (error?.code) wrapped.code = error.code;
  if (error?.stack) wrapped.stack = `${wrapped.name}: ${wrapped.message}\ncaused by: ${error.stack}`;
  return wrapped;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  if (!event || typeof event !== "object") return undefined;
  const eventType = normalizeText(typeof event.type === "string" ? event.type : "").toLowerCase();
  const errorMessage = normalizeText(
    typeof event.message === "string"
      ? event.message
      : typeof event.text === "string"
      ? event.text
      : "",
  );
  if (eventType === "error") {
    if (isTransientStreamErrorHint(errorMessage)) return undefined;
    if (errorMessage) return errorMessage.length <= 180 ? errorMessage : truncate(errorMessage, 180);
    return undefined;
  }
  const candidates = [
    event.status,
    event.phase,
    event.event,
    event.kind,
    event.type,
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

function isTransientStreamErrorHint(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("reconnecting") ||
    normalized.includes("stream disconnected before completion") ||
    normalized.includes("stream closed before response.completed")
  );
}

function resolveHeartbeatIntervalMs(baseHeartbeatMs, elapsedMs) {
  const safeBase = Math.max(1000, Number.isFinite(baseHeartbeatMs) ? Math.trunc(baseHeartbeatMs) : 30000);
  if (elapsedMs >= 60 * 1000) return Math.max(safeBase, 60 * 1000);
  return safeBase;
}

function resolveHeartbeatBucket(elapsedMs) {
  if (elapsedMs >= 10 * 60 * 1000) return "t10m+";
  if (elapsedMs >= 3 * 60 * 1000) return "t3m-10m";
  if (elapsedMs >= 60 * 1000) return "t1m-3m";
  return "t0-1m";
}

function compactHeartbeatVisibleHint(hint) {
  const normalized = normalizeText(hint);
  if (!normalized) return "";
  const maxLength = 72;
  if (normalized.length <= maxLength) return normalized;
  return truncate(normalized, maxLength);
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toErrorText(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        error: toErrorText(error),
        summary: normalizeText(stderr || stdout || toErrorText(error)),
      });
    });
    child.on("close", (code) => {
      const summary = normalizeText(stdout || stderr);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        error: typeof code === "number" && code === 0 ? null : normalizeText(stderr) || null,
        summary,
      });
    });
  });
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
  const lines = collectNamedSectionLines(text, "changed");
  if (lines.length === 0) return [];
  const matches = new Set();
  for (const line of lines) {
    const normalizedLine = normalizeText(line.replace(/^[-*]\s+/, ""));
    if (!normalizedLine) continue;
    if (/^(?:无|none|n\/a)$/i.test(normalizedLine)) continue;
    const fencedMatches = Array.from(normalizedLine.matchAll(/`([^`\n]+)`/g), (match) => normalizeText(match[1]));
    if (fencedMatches.length > 0) {
      for (const candidate of fencedMatches) {
        if (!candidate || candidate.length > 200) continue;
        matches.add(candidate);
        if (matches.size >= DEFAULT_MAX_CHANGED_FILES) return Array.from(matches);
      }
      continue;
    }
    if (!looksLikeFilePathCandidate(normalizedLine)) continue;
    matches.add(normalizedLine);
    if (matches.size >= DEFAULT_MAX_CHANGED_FILES) {
      return Array.from(matches);
    }
  }
  return Array.from(matches);
}

function extractNextSteps(text) {
  if (!text) return [];
  const lines = collectNamedSectionLines(text, "next");
  if (lines.length === 0) return [];
  const output = [];
  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine) continue;
    if (/^[-*]\s+/.test(normalizedLine)) output.push(normalizedLine.replace(/^[-*]\s+/, "").trim());
    else output.push(normalizedLine);
  }
  return uniqueStrings(output.filter(Boolean));
}

function extractSummarySection(text) {
  if (!text) return null;
  const explicitSummary = collectNamedSectionLines(text, "summary");
  if (explicitSummary.length > 0) {
    return normalizeText(explicitSummary.join("\n")) || null;
  }
  const lines = text.split(/\r?\n/);
  const firstStructuredSectionIndex = lines.findIndex((line) => {
    const kind = resolveStructuredSectionKind(normalizeHeadingLine(line.trim()));
    return kind === "changed" || kind === "next" || kind === "manifest";
  });
  const leadingText = lines.slice(0, firstStructuredSectionIndex >= 0 ? firstStructuredSectionIndex : lines.length).join("\n");
  return normalizeText(leadingText) || null;
}

function collectNamedSectionLines(text, targetKind) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const output = [];
  let collecting = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const normalizedLine = normalizeHeadingLine(trimmed);
    const kind = resolveStructuredSectionKind(normalizedLine);
    if (kind) {
      if (collecting && kind !== targetKind) break;
      if (kind === targetKind) {
        collecting = true;
        const cleaned = stripStructuredSectionHeading(normalizedLine, kind);
        if (cleaned) output.push(cleaned);
      }
      continue;
    }
    if (collecting) output.push(trimmed);
  }
  return trimSectionLines(output);
}

function resolveStructuredSectionKind(line) {
  if (/^(summary|摘要|总结)\b[:：]?/i.test(line)) return "summary";
  if (/^(changed\s+files?|changed\s+file|改动文件|修改文件)\b[:：]?/i.test(line)) return "changed";
  if (/^(next(?:\s+steps?)?|下一步|后续建议)\b[:：]?/i.test(line)) return "next";
  if (/^(delivery\s+manifest|交付清单|回传清单)\b[:：]?/i.test(line)) return "manifest";
  return null;
}

function stripStructuredSectionHeading(line, kind) {
  if (kind === "summary") return line.replace(/^(summary|摘要|总结)\b[:：]?\s*/i, "").trim();
  if (kind === "changed") return line.replace(/^(changed\s+files?|changed\s+file|改动文件|修改文件)\b[:：]?\s*/i, "").trim();
  if (kind === "next") return line.replace(/^(next(?:\s+steps?)?|下一步|后续建议)\b[:：]?\s*/i, "").trim();
  if (kind === "manifest") return line.replace(/^(delivery\s+manifest|交付清单|回传清单)\b[:：]?\s*/i, "").trim();
  return line.trim();
}

function trimSectionLines(lines) {
  const output = [...lines];
  while (output.length > 0 && !normalizeText(output[0])) output.shift();
  while (output.length > 0 && !normalizeText(output[output.length - 1])) output.pop();
  return output;
}

function normalizeHeadingLine(line) {
  return line.replace(/^[*_#\s`]+/, "").replace(/[*_`#\s]+$/, "").trim();
}

function uniqueStrings(items) {
  return Array.from(new Set(items));
}

function looksLikeFilePathCandidate(value) {
  if (!value || value.length > 200) return false;
  return /(?:^|[\\/])[^\\/\s`]+(?:[\\/][^\\/\s`]+)*\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?$/.test(value) || /^[^/\s`]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?$/.test(value);
}

function looksLikeBenignCodexWarning(line) {
  const lower = line.toLowerCase();
  const isRouterExecNoise =
    lower.includes("codex_core::tools::router") &&
    lower.includes("exec_command failed") &&
    lower.includes("createprocess");
  return (
    isRouterExecNoise ||
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
