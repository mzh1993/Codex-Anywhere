const DEFAULT_LOCALE = "en-US";
const DEFAULT_MAX_CHANGED_FILES = 8;

const TASK_STATUS_LABELS = {
  "zh-CN": {
    created: "已创建",
    running: "运行中",
    awaiting_input: "等待输入",
    awaiting_approval: "等待审批",
    aborted: "已终止",
    completed: "已完成",
  },
};

const REASON_LABELS = {
  "zh-CN": {
    host_mutation_requires_approval: "会修改宿主机上的 Codex 状态。",
    service_control_requires_approval: "会控制系统服务。",
    process_control_requires_approval: "会启动或控制长期运行进程。",
    remote_boundary_requires_approval: "会连接远端主机或向外发送内容。",
    global_env_change_requires_approval: "会变更全局环境。",
    destructive_change_requires_approval: "包含破坏性修改。",
    isolation_boundary_denied: "会突破隔离运行边界。",
    transport_mutation_denied: "会修改传输层集成。",
    policy_bypass_denied: "看起来在尝试绕过策略。",
    out_of_scope_admin_denied: "属于超出范围的管理员操作。",
  },
  "en-US": {
    host_mutation_requires_approval: "Touches host Codex state.",
    service_control_requires_approval: "Controls system services.",
    process_control_requires_approval: "Starts or controls long-running processes.",
    remote_boundary_requires_approval: "Crosses a remote or outbound execution boundary.",
    global_env_change_requires_approval: "Changes the global environment.",
    destructive_change_requires_approval: "Includes destructive changes.",
    isolation_boundary_denied: "Crosses the isolated runner boundary.",
    transport_mutation_denied: "Mutates the transport integration.",
    policy_bypass_denied: "Looks like a policy bypass attempt.",
    out_of_scope_admin_denied: "Is an out-of-scope admin action.",
  },
};

export function normalizeLocale(value) {
  const normalized = normalizeText(typeof value === "string" ? value : "");
  if (!normalized) return DEFAULT_LOCALE;
  if (/^zh(?:[-_].*)?$/i.test(normalized)) return "zh-CN";
  return "en-US";
}

export function localizeStatusHint(locale, hint) {
  const normalized = normalizeText(hint);
  if (!normalized) return "";
  const key = normalized.toLowerCase();
  const language = normalizeLocale(locale);
  if (language === "zh-CN") {
    const mapped = {
      "thread.started": "任务线程已启动",
      "turn.started": "开始执行",
      "turn.completed": "执行完成",
      "run.interrupted": "上一轮执行中断，请明确继续",
    };
    return mapped[key] ?? normalized;
  }
  const mapped = {
    "run.interrupted": "Previous run interrupted. Continue explicitly.",
  };
  return mapped[key] ?? normalized;
}

export function localizeTaskStatus(locale, status) {
  const normalized = normalizeLocale(locale);
  return TASK_STATUS_LABELS[normalized]?.[status] ?? status;
}

function resolveFinishedRunStatus(task) {
  if (task.runStatus) return task.runStatus;
  if (task.status === "aborted" || task.signal === "SIGTERM" || task.signal === "SIGKILL") return "aborted";
  if (task.error || (typeof task.exitCode === "number" && task.exitCode !== 0)) return "failed";
  return "completed";
}

function localizeMode(locale, mode) {
  if (normalizeLocale(locale) !== "zh-CN") return mode;
  return mode === "resume" ? "继续任务" : "新任务";
}

function localizeRisk(locale, riskLevel) {
  if (normalizeLocale(locale) !== "zh-CN") return riskLevel;
  return riskLevel === "high" ? "高风险" : "普通";
}

function localizeReason(locale, reasonCode) {
  const normalized = normalizeLocale(locale);
  return REASON_LABELS[normalized]?.[reasonCode] ?? reasonCode;
}

function formatReasonLine(locale, reasonCode) {
  return `- ${reasonCode}: ${localizeReason(locale, reasonCode)}`;
}

function getActiveTaskDetails(input, status) {
  if (typeof input === "object" && input !== null) return input;
  return { taskId: input, status };
}

function getActiveTaskActionLine(locale, suggestedCommand) {
  const normalized = normalizeLocale(locale);
  const command = suggestedCommand ?? "/codex continue <prompt>";
  if (normalized === "zh-CN") {
    if (command === "/codex continue <prompt>") {
      return `请使用 \`${command}\` 提交明确的继续输入。`;
    }
    return `请先使用 \`${command}\` 处理当前任务。`;
  }
  if (command === "/codex continue <prompt>") {
    return `Use \`${command}\` to add input explicitly.`;
  }
  return `Use \`${command}\` to handle the current task first.`;
}

function getActiveTaskFallbackLine(locale, suggestedCommand) {
  const normalized = normalizeLocale(locale);
  const statusIncluded = suggestedCommand === "/codex status";
  if (normalized === "zh-CN") {
    return statusIncluded ? "也可以使用 `/codex abort`。" : "也可以使用 `/codex status` 或 `/codex abort`。";
  }
  return statusIncluded ? "Use `/codex abort` if needed." : "Use `/codex status` or `/codex abort` if needed.";
}

export function getLocaleText(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized === "zh-CN") {
    return {
      locale: normalized,
      usageCwd: "用法：`/codex cwd <path>`",
      usageApprove: "用法：`/codex approve <token>`",
      usageContinue: "用法：`/codex continue <prompt>`",
      noRunningTaskToAbort: "当前没有可终止的任务。",
      noPreviousSession: "当前没有可继续的活动任务。",
      noActiveTaskToContinue: "当前没有可继续的活动任务。",
      noPendingApproval: "当前没有待审批的活动任务。",
      interruptedTaskRequiresContinue: (taskId) => [
        `任务 ${taskId} 的上一轮执行已中断。`,
        "请明确继续。",
        "请使用 `/codex continue <prompt>`。",
      ].join("\n"),
      approvalTokenDifferentDm: "这个审批令牌属于另一个私聊。",
      noBridgeState: "这个私聊还没有记录任何 Codex bridge 状态。",
      noActiveTask: "当前没有活动任务。",
      lastLabel: "最近状态",
      runnerLanguageInstruction: "Respond in Simplified Chinese. If you use sections, use Chinese headings such as: 总结、改动文件、下一步。",
      bridgeError: (errorText) => `Codex bridge 错误：${errorText}`,
      executionRuntimeUnavailable: (errorText) => [
        "执行环境不兼容，任务未启动。",
        `原因：${errorText}`,
      ].join("\n"),
      currentCwd: (cwd) => `当前工作目录：\`${cwd}\``,
      directoryNotFound: (cwd) => `目录不存在：\`${cwd}\``,
      defaultCwdUpdated: (cwd) => `默认工作目录已更新为 \`${cwd}\``,
      abortRequested: (taskId) => `已请求终止任务 ${taskId}。`,
      approvalTokenNotFound: (token) => `未找到审批令牌：${token}`,
      approvalTokenExpired: (token) => `审批令牌已过期：${token}`,
      cwdBlocked: (cwd) => `工作目录被 bridge 策略阻止：${cwd}`,
      malformedCodexCommand: (command) => [
        "命令前不要加多余前缀。",
        `请直接使用 \`${command}\`。`,
      ].join("\n"),
      help: (cwd) => [
        "Codex Runner 命令：",
        "`/codex cwd <path>` 设置默认工作目录",
        "`/codex pwd` 查看当前工作目录",
        "`/codex continue <prompt>` 向当前活动任务补充明确输入",
        "`/codex status` 查看当前任务状态",
        "`/codex abort` 停止当前任务",
        "`/codex approve <token>` 批准高风险请求",
        "`/codex help` 查看帮助",
        "",
        `默认工作目录：\`${cwd}\``,
      ].join("\n"),
      taskAlreadyRunning: (input, status) => {
        const details = getActiveTaskDetails(input, status);
        return [
          `已有活动任务：${details.taskId}`,
          ...(details.status ? [`状态：${localizeTaskStatus(normalized, details.status)}`] : []),
          ...(details.code ? [`代码：${details.code}`] : []),
          getActiveTaskActionLine(normalized, details.suggestedCommand),
          getActiveTaskFallbackLine(normalized, details.suggestedCommand),
        ].join("\n");
      },
      requestRejected: (reasons) => [
        "请求被 Codex bridge 策略拒绝。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      ].join("\n"),
      approvalQueued: ({ token, mode, cwd, reasons, status = "awaiting_approval" }) => [
        "高风险请求已进入审批队列。",
        `状态：${localizeTaskStatus(normalized, status)}`,
        `审批令牌：\`${token}\``,
        `模式：${localizeMode(normalized, mode)}`,
        `工作目录：\`${cwd}\``,
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "",
        `请用 \`/codex approve ${token}\` 批准执行`,
      ].join("\n"),
      taskStarted: (task) => [
        "Codex 任务已启动。",
        `任务 ID：${task.taskId}`,
        `工作目录：\`${task.cwd}\``,
        `模式：${localizeMode(normalized, task.mode)}`,
        `风险：${localizeRisk(normalized, task.riskLevel)}`,
        ...(task.sessionId ? [`会话 ID：${task.sessionId}`] : []),
      ].join("\n"),
      taskProgress: (taskId, hint) => [`任务 ${taskId} 进度`, localizeStatusHint(normalized, hint)].join("\n"),
      taskStillRunning: (taskId, elapsed, suffix) => `任务 ${taskId} 仍在运行（${elapsed}）。${suffix}`,
      activeTaskLine: (taskId) => `活动任务：${taskId}`,
      statusLine: (status) => `状态：${localizeTaskStatus(normalized, status)}`,
      cwdLine: (cwd) => `工作目录：\`${cwd}\``,
      modeLine: (mode) => `模式：${localizeMode(normalized, mode)}`,
      riskLine: (risk) => `风险：${localizeRisk(normalized, risk)}`,
      elapsedLine: (elapsed) => `耗时：${elapsed}`,
      sessionIdLine: (sessionId) => `会话 ID：${sessionId}`,
      lastLine: (hint) => `最近状态：${hint}`,
      lastTaskIdLine: (taskId) => `上次任务 ID：${taskId}`,
      lastSessionIdLine: (sessionId) => `上次会话 ID：${sessionId}`,
      pendingApprovalLine: (token) => `待审批令牌：${token}`,
      taskFinished: (task) => {
        const runStatus = resolveFinishedRunStatus(task);
        const lines = [];
        if (task.status === "awaiting_input") {
          if (runStatus === "completed") lines.push(`本轮执行已完成：${task.taskId}`);
          else lines.push(`本轮执行失败：${task.taskId}`);
          lines.push(`状态：${localizeTaskStatus(normalized, task.status)}`);
        } else if (runStatus === "completed") lines.push(`Codex 任务已完成：${task.taskId}`);
        else if (runStatus === "aborted") lines.push(`Codex 任务已终止：${task.taskId}`);
        else lines.push(`Codex 任务失败：${task.taskId}`);
        lines.push(`工作目录：\`${task.cwd}\``);
        if (task.sessionId) lines.push(`会话 ID：${task.sessionId}`);
        if (task.summary) {
          lines.push("");
          lines.push(task.summary);
        }
        if (task.changedFiles.length > 0) {
          lines.push("");
          lines.push("改动文件：");
          for (const file of task.changedFiles.slice(0, DEFAULT_MAX_CHANGED_FILES)) lines.push(`- \`${file}\``);
        }
        if (task.nextSteps.length > 0) {
          lines.push("");
          lines.push("下一步：");
          for (const step of task.nextSteps.slice(0, 3)) lines.push(`- ${step}`);
        }
        if (!task.summary && task.error) {
          lines.push("");
          lines.push(`错误：${task.error}`);
        }
        return lines.join("\n");
      },
    };
  }

  return {
    locale: normalized,
    usageCwd: "Usage: `/codex cwd <path>`",
    usageApprove: "Usage: `/codex approve <token>`",
    usageContinue: "Usage: `/codex continue <prompt>`",
    noRunningTaskToAbort: "No active task to abort.",
    noPreviousSession: "No active task to continue.",
    noActiveTaskToContinue: "No active task to continue.",
    noPendingApproval: "No active task awaiting approval.",
    interruptedTaskRequiresContinue: (taskId) => [
      `Previous run interrupted for task ${taskId}.`,
      "Continue explicitly.",
      "Use `/codex continue <prompt>`.",
    ].join("\n"),
    approvalTokenDifferentDm: "This approval token belongs to a different DM.",
    noBridgeState: "No Codex bridge state recorded for this DM.",
    noActiveTask: "No active task.",
    lastLabel: "last",
    runnerLanguageInstruction: "Respond in English. If you use sections, use English headings such as: Summary, Changed Files, Next Steps.",
    bridgeError: (errorText) => `Codex bridge error: ${errorText}`,
    executionRuntimeUnavailable: (errorText) => [
      "Execution runtime incompatible; task not started.",
      `Reason: ${errorText}`,
    ].join("\n"),
    currentCwd: (cwd) => `Current cwd: \`${cwd}\``,
    directoryNotFound: (cwd) => `Directory not found: \`${cwd}\``,
    defaultCwdUpdated: (cwd) => `Default cwd updated to \`${cwd}\``,
    abortRequested: (taskId) => `Abort requested for ${taskId}.`,
    approvalTokenNotFound: (token) => `Approval token not found: ${token}`,
    approvalTokenExpired: (token) => `Approval token expired: ${token}`,
    cwdBlocked: (cwd) => `cwd is blocked by bridge policy: ${cwd}`,
    malformedCodexCommand: (command) => [
      "Do not prefix Codex commands with extra punctuation.",
      `Use \`${command}\` directly.`,
    ].join("\n"),
    help: (cwd) => [
      "Codex Runner commands:",
      "`/codex cwd <path>` set default cwd",
      "`/codex pwd` show current cwd",
      "`/codex continue <prompt>` add explicit input to the current active task",
      "`/codex status` show current task state",
      "`/codex abort` stop current task",
      "`/codex approve <token>` approve a high-risk request",
      "`/codex help` show this help",
      "",
      `Default cwd: \`${cwd}\``,
    ].join("\n"),
    taskAlreadyRunning: (input, status) => {
      const details = getActiveTaskDetails(input, status);
      return [
        `Task already active: ${details.taskId}`,
        ...(details.status ? [`Status: ${localizeTaskStatus(normalized, details.status)}`] : []),
        ...(details.code ? [`Code: ${details.code}`] : []),
        getActiveTaskActionLine(normalized, details.suggestedCommand),
        getActiveTaskFallbackLine(normalized, details.suggestedCommand),
      ].join("\n");
    },
    requestRejected: (reasons) => [
      "Request rejected by Codex bridge policy.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
    ].join("\n"),
    approvalQueued: ({ token, mode, cwd, reasons, status = "awaiting_approval" }) => [
      "High-risk request queued for approval.",
      `Status: ${localizeTaskStatus(normalized, status)}`,
      `Token: \`${token}\``,
      `Mode: ${localizeMode(normalized, mode)}`,
      `Cwd: \`${cwd}\``,
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      "",
      `Approve with \`/codex approve ${token}\``,
    ].join("\n"),
    taskStarted: (task) => [
      "Codex task started.",
      `task_id: ${task.taskId}`,
      `cwd: \`${task.cwd}\``,
      `mode: ${localizeMode(normalized, task.mode)}`,
      `risk: ${localizeRisk(normalized, task.riskLevel)}`,
      ...(task.sessionId ? [`session_id: ${task.sessionId}`] : []),
    ].join("\n"),
    taskProgress: (taskId, hint) => [`Task ${taskId} progress`, localizeStatusHint(normalized, hint)].join("\n"),
    taskStillRunning: (taskId, elapsed, suffix) => `Task ${taskId} still running (${elapsed}).${suffix}`,
    activeTaskLine: (taskId) => `Active task: ${taskId}`,
    statusLine: (status) => `status: ${localizeTaskStatus(normalized, status)}`,
    cwdLine: (cwd) => `cwd: \`${cwd}\``,
    modeLine: (mode) => `mode: ${localizeMode(normalized, mode)}`,
    riskLine: (risk) => `risk: ${localizeRisk(normalized, risk)}`,
    elapsedLine: (elapsed) => `elapsed: ${elapsed}`,
    sessionIdLine: (sessionId) => `session_id: ${sessionId}`,
    lastLine: (hint) => `last: ${hint}`,
    lastTaskIdLine: (taskId) => `last_task_id: ${taskId}`,
    lastSessionIdLine: (sessionId) => `last_session_id: ${sessionId}`,
    pendingApprovalLine: (token) => `pending_approval: ${token}`,
    taskFinished: (task) => {
      const runStatus = resolveFinishedRunStatus(task);
      const lines = [];
      if (task.status === "awaiting_input") {
        if (runStatus === "completed") lines.push(`Codex run completed: ${task.taskId}`);
        else lines.push(`Codex run failed: ${task.taskId}`);
        lines.push(`status: ${localizeTaskStatus(normalized, task.status)}`);
      } else if (runStatus === "completed") lines.push(`Codex task completed: ${task.taskId}`);
      else if (runStatus === "aborted") lines.push(`Codex task aborted: ${task.taskId}`);
      else lines.push(`Codex task failed: ${task.taskId}`);
      lines.push(`cwd: \`${task.cwd}\``);
      if (task.sessionId) lines.push(`session_id: ${task.sessionId}`);
      if (task.summary) {
        lines.push("");
        lines.push(task.summary);
      }
      if (task.changedFiles.length > 0) {
        lines.push("");
        lines.push("Changed files:");
        for (const file of task.changedFiles.slice(0, DEFAULT_MAX_CHANGED_FILES)) lines.push(`- \`${file}\``);
      }
      if (task.nextSteps.length > 0) {
        lines.push("");
        lines.push("Next:");
        for (const step of task.nextSteps.slice(0, 3)) lines.push(`- ${step}`);
      }
      if (!task.summary && task.error) {
        lines.push("");
        lines.push(`Error: ${task.error}`);
      }
      return lines.join("\n");
    },
  };
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
