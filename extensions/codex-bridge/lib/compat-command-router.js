const COMPAT_CODEX_COMMANDS = new Set(["help", "status", "abort", "approve"]);

export function isCompatCodexCommand(name) {
  return typeof name === "string" && COMPAT_CODEX_COMMANDS.has(name);
}

export async function handleCompatCodexCommand({
  bridge,
  parsed,
  request,
  profile,
  routeAbortCommand,
  routeApproveCommand,
}) {
  if (parsed.name === "help") {
    await bridge.sendHelp(request, profile);
    return;
  }

  if (parsed.name === "status") {
    const statusText = await bridge.formatStatus(profile.senderId, profile);
    await bridge.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: statusText,
    });
    return;
  }

  if (parsed.name === "abort") {
    const activeTask = await bridge.loadActiveTask(profile.senderId, profile);
    const abortRoute = routeAbortCommand({ activeTaskStatus: activeTask?.status ?? null });
    if (!abortRoute.accepted) {
      await bridge.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: bridge.text.noRunningTaskToAbort,
      });
      return;
    }
    if (bridge.getActiveTask(profile.senderId)?.taskId === activeTask.taskId) {
      await bridge.stopTask(activeTask, "aborted by user");
    } else {
      await bridge.finalizeStoredTask(activeTask, profile, {
        status: "aborted",
        error: "aborted by user",
      });
    }
    await bridge.safeReply({
      accountId: request.accountId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      text: bridge.text.abortRequested(activeTask.taskId),
    });
    return;
  }

  if (parsed.name === "approve") {
    const approvalToken = extractFirstArgToken(parsed.args);
    if (!approvalToken) {
      await bridge.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: bridge.text.usageApprove,
      });
      return;
    }
    const activeBridgeAction = await bridge.loadActiveBridgeAction(profile.senderId, profile);
    if (activeBridgeAction?.status === "awaiting_approval") {
      await bridge.approvePendingBridgeActionRequest(profile, request, approvalToken);
      return;
    }

    const activeTask = await bridge.loadActiveTask(profile.senderId, profile);
    const approveRoute = routeApproveCommand({ activeTaskStatus: activeTask?.status ?? null });
    if (!approveRoute.accepted) {
      if (activeTask) {
        await bridge.safeReply({
          accountId: request.accountId,
          conversationId: request.conversationId,
          messageId: request.messageId,
          text: bridge.text.taskAlreadyRunning({
            taskId: activeTask.taskId,
            status: activeTask.status,
            code: approveRoute.code,
            suggestedCommand: approveRoute.suggestedCommand,
          }),
        });
        return;
      }
      await bridge.safeReply({
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        text: bridge.text.noPendingApproval,
      });
      return;
    }
    await bridge.approvePendingRequest(profile, request, approvalToken);
  }
}

function extractFirstArgToken(args) {
  if (!args) return "";
  const [token = ""] = String(args).trim().split(/\s+/);
  return token;
}
