const DEFAULT_LOCALE = "en-US";
const DEFAULT_MAX_CHANGED_FILES = 8;
const HIDDEN_STATUS_HINT_PATTERNS = [
  /^(?:thread|turn|item)\./i,
  /^error$/i,
  /^reconnecting/i,
  /stream disconnected before completion/i,
  /stream closed before response\.completed/i,
];

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
    host_codex_boundary_requires_approval: "会触碰宿主机上的 Codex 状态目录。",
    outside_cwd_write_requires_approval: "会写入当前受控工作目录之外的宿主路径。",
    install_lifecycle_requires_approval: "会修改桥接器的仓库自有安装或服务配置。",
    service_control_requires_approval: "会控制系统服务。",
    scheduler_control_requires_approval: "会创建或控制计划任务。",
    process_control_requires_approval: "会启动或控制长期运行进程。",
    remote_boundary_requires_approval: "会连接远端主机或向外发送内容。",
    container_control_requires_approval: "会控制容器或编排执行平面。",
    publication_boundary_requires_approval: "会向仓库、包仓库或发布通道对外发布内容。",
    host_secret_boundary_denied: "会触碰宿主机上的凭证或秘密材料。",
    global_env_change_requires_approval: "会变更全局环境。",
    destructive_change_requires_approval: "包含破坏性修改。",
    protected_root_requires_approval: "会进入受保护的宿主机边界。",
    native_dangerous_sandbox_requires_approval: "显式请求了危险的原生沙箱模式。",
    native_never_approval_requires_approval: "显式请求了不再询问审批的原生模式。",
    isolation_boundary_denied: "会突破隔离运行边界。",
    transport_mutation_denied: "会修改传输层集成。",
    policy_bypass_denied: "看起来在尝试绕过策略。",
    out_of_scope_admin_denied: "属于超出范围的管理员操作。",
  },
  "en-US": {
    host_codex_boundary_requires_approval: "Touches the host Codex state directory.",
    outside_cwd_write_requires_approval: "Writes to a host path outside the current controlled working directory.",
    install_lifecycle_requires_approval: "Modifies bridge-owned installation or service configuration.",
    service_control_requires_approval: "Controls system services.",
    scheduler_control_requires_approval: "Creates or controls scheduled tasks.",
    process_control_requires_approval: "Starts or controls long-running processes.",
    remote_boundary_requires_approval: "Crosses a remote or outbound execution boundary.",
    container_control_requires_approval: "Controls a container or orchestration execution plane.",
    publication_boundary_requires_approval: "Publishes content to a repo, registry, or release channel.",
    host_secret_boundary_denied: "Touches host credential or secret material.",
    global_env_change_requires_approval: "Changes the global environment.",
    destructive_change_requires_approval: "Includes destructive changes.",
    protected_root_requires_approval: "Enters a protected host boundary.",
    native_dangerous_sandbox_requires_approval: "Explicitly requests a dangerous native sandbox mode.",
    native_never_approval_requires_approval: "Explicitly requests a native no-approval mode.",
    isolation_boundary_denied: "Crosses the isolated bridge boundary.",
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
      "run.interrupted": "上一轮执行中断，请直接说明要继续做什么",
      "run.interrupted.bridge_self_restart": "桥接服务自重启打断了本轮执行；现在已恢复，请直接说明下一步",
    };
    return mapped[key] ?? normalized;
  }
  const mapped = {
    "run.interrupted": "Previous run was interrupted. Say what to continue with.",
    "run.interrupted.bridge_self_restart": "The bridge restarted itself and interrupted this run. It is back now; say the next step directly.",
  };
  return mapped[key] ?? normalized;
}

export function getUserVisibleStatusHint(locale, hint) {
  const normalized = normalizeText(hint);
  if (!normalized) return "";
  if (HIDDEN_STATUS_HINT_PATTERNS.some((pattern) => pattern.test(normalized))) return "";
  return localizeStatusHint(locale, normalized);
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

function localizeAccessMode(locale, accessMode) {
  if (normalizeLocale(locale) !== "zh-CN") return accessMode === "full_access" ? "Full Access" : "Normal";
  return accessMode === "full_access" ? "完全访问" : "普通";
}

function localizeReason(locale, reasonCode) {
  const normalized = normalizeLocale(locale);
  return REASON_LABELS[normalized]?.[reasonCode] ?? reasonCode;
}

function formatReasonLine(locale, reasonCode) {
  return `- ${reasonCode}: ${localizeReason(locale, reasonCode)}`;
}

function getDefaultResumeCommand(locale) {
  return normalizeLocale(locale) === "zh-CN" ? "/codex resume 继续" : "/codex resume continue";
}

function getNativeUsageNew(locale) {
  return normalizeLocale(locale) === "zh-CN"
    ? "用法：`/codex --cd . 帮我看看当前目录`"
    : "Usage: `/codex --cd . summarize the current directory`";
}

function getNativeUsageResume(locale) {
  return normalizeLocale(locale) === "zh-CN" ? "用法：`/codex resume 继续`" : "Usage: `/codex resume continue`";
}

function getNativeOptionalFlagsExample(locale) {
  return normalizeLocale(locale) === "zh-CN"
    ? "可选参数：`--model gpt-5.2` `--reasoning medium` `--ask-for-approval never`"
    : "Optional flags: `--model gpt-5.2` `--reasoning medium` `--ask-for-approval never`";
}

function getDefaultCwdHint(locale) {
  return normalizeLocale(locale) === "zh-CN"
    ? "默认工作目录：当前私聊最近一次目录；若没有，则使用默认目录（通常是当前用户主目录）"
    : "Default cwd: most recent cwd in this DM; otherwise the default directory (usually the current user's home directory).";
}

function getNativeHelpLines(locale) {
  if (normalizeLocale(locale) === "zh-CN") {
    return [
      "默认直接发送自然语言给 Codex。",
      "新任务：`/codex --cd . 帮我看看当前目录`",
      "完全访问：`/codex --cd . --sandbox danger-full-access 帮我看看当前目录`",
      "续写：`/codex resume 继续`",
      getNativeOptionalFlagsExample(locale),
      "健康检查：`/codex doctor`",
      getDefaultCwdHint(locale),
    ];
  }
  return [
    "For normal work, just send a plain message to Codex.",
    "New task: `/codex --cd . summarize the current directory`",
    "Full access: `/codex --cd . --sandbox danger-full-access summarize the current directory`",
    "Resume: `/codex resume continue`",
    getNativeOptionalFlagsExample(locale),
    "Health check: `/codex doctor`",
    getDefaultCwdHint(locale),
  ];
}

function getActiveTaskDetails(input, status) {
  if (typeof input === "object" && input !== null) return input;
  return { taskId: input, status };
}

function getActiveTaskActionLine(locale, details) {
  const normalized = normalizeLocale(locale);
  const defaultResumeCommand = getDefaultResumeCommand(normalized);
  const command = details.suggestedCommand ?? defaultResumeCommand;
  const status = details.status ?? "";
  if (normalized === "zh-CN") {
    if (status === "running") {
      return "当前任务仍在运行，请等待当前任务完成。";
    }
    if (status === "awaiting_approval") {
      return "当前任务正在等待审批，请先处理当前审批。";
    }
    if (status === "awaiting_input") {
      return "当前任务正在等待你的下一条输入，你可以直接回复。";
    }
    if (command === defaultResumeCommand) {
      return `你也可以使用 \`${command}\` 显式续写。`;
    }
    return `请先使用 \`${command}\` 处理当前任务。`;
  }
  if (status === "running") {
    return "This task is still running. Wait for it to finish.";
  }
  if (status === "awaiting_approval") {
    return "This task is waiting for approval. Handle that approval first.";
  }
  if (status === "awaiting_input") {
    return "This task is waiting for your next message. You can reply directly.";
  }
  if (command === defaultResumeCommand) {
    return `You can also use \`${command}\` for an explicit resume.`;
  }
  return `Use \`${command}\` to handle the current task first.`;
}

function getActiveTaskFallbackLine(locale, details) {
  const status = details.status ?? "";
  const resumeCommand = getDefaultResumeCommand(locale);
  if (normalizeLocale(locale) === "zh-CN") {
    if (status === "awaiting_input") {
      return `如需兜底，也可以使用 \`${resumeCommand}\`。`;
    }
    return "";
  }
  if (status === "awaiting_input") {
    return `If needed, you can also use \`${resumeCommand}\` as a fallback.`;
  }
  return "";
}

export function getLocaleText(locale) {
  const normalized = normalizeLocale(locale);
  if (normalized === "zh-CN") {
    return {
      locale: normalized,
      usageNativeNew: getNativeUsageNew(normalized),
      usageNativeResume: getNativeUsageResume(normalized),
      noPreviousSession: "当前没有可继续的活动任务。",
      noActiveTaskToContinue: "当前没有可继续的活动任务。",
      noPendingApproval: "当前没有待审批的活动任务。",
      nativeOptionMissingValue: (option, usage) => [`缺少 \`${option}\` 的参数值。`, usage].join("\n"),
      nativeOptionInvalidValue: (option, value, allowedValues) => [
        `\`${option}\` 的值无效：\`${value}\`。`,
        `允许值：${allowedValues.map((entry) => `\`${entry}\``).join("、")}`,
      ].join("\n"),
      nativeUnknownOption: (option) => [
        `暂不支持这个原生命令参数：\`${option}\`。`,
        "当前 `/codex` 透传的显式启动参数为：`--cd`、`--model`、`--reasoning`、`--sandbox`、`--ask-for-approval`。",
      ].join("\n"),
      bridgeActionBlockedByRunningTask: "当前 Codex 任务仍在运行；请等本轮结束后再做这个控制面动作。",
      bridgeActionAlreadyRunning: "当前已有控制面动作在执行；请等它结束后再试。",
      bridgeActionApprovalNeedsPureApprove: "这一步只接受纯批准。请直接回复“同意”或“不要执行”。",
      bridgeActionDenied: "已取消这次控制面动作。",
      bridgeActionLine: (status) => `控制面动作：${localizeTaskStatus(normalized, status)}`,
      bridgeActionApprovalStillPending: ({ token, reasons = [] }) => [
        "这一步仍在等待你的明确审批。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "你可以直接回复“同意”批准，回复“不要执行”拒绝。",
      ].join("\n"),
      bridgeActionApprovalQueued: ({ token, reasons = [] }) => [
        "这一步已进入审批。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "可直接回复“同意”批准，回复“不要执行”拒绝。",
      ].join("\n"),
      bridgeActionFinished: ({ summary = "", resultStatus = "completed", error = null }) => {
        if (summary) return summary;
        if (resultStatus === "denied") return "已取消这次控制面动作。";
        if (resultStatus === "failed") return error ? `控制面动作失败：${error}` : "控制面动作失败。";
        return "控制面动作已完成。";
      },
      approvalStillPending: ({ token, reasons = [] }) => [
        "这一步仍在等待你的明确审批。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "你可以直接回复“同意”批准，回复“不要执行”拒绝。",
        "如需补充要求，也可以回复“同意，并……”。",
      ].join("\n"),
      approvalTailScopeChanged: ({ token, reasons = [] }) => [
        "补充要求超出了这次审批的边界，原审批仍保持未消费。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "如需执行补充要求，请单独发新消息，或先纯回复“同意”批准当前这一步。",
      ].join("\n"),
      approvalGrantScopeChanged: ({ token, reasons = [] }) => [
        "这次审批对应的运行边界已变化，原审批仍保持未消费。",
        ...reasons.map((reason) => formatReasonLine(normalized, reason)),
        "请重新发起这一步，或先取消当前审批后再试。",
      ].join("\n"),
      approvalDeniedAwaitingReplan: "已拒绝这次高风险动作。任务已回到可继续状态，请给我一个更安全的下一步。",
      approvalDeniedTaskAborted: "已拒绝这次高风险动作。当前任务已终止。",
      approvalTokenConsumed: (token) => `这个审批令牌已被消费，不能再次使用：${token}`,
      interruptedTaskRequiresContinue: (taskId, hint = "run.interrupted") => [
        `任务 ${taskId} 的上一轮执行已中断。`,
        getUserVisibleStatusHint(normalized, hint),
        `如需兜底，也可以使用 \`${getDefaultResumeCommand(normalized)}\`。`,
      ].join("\n"),
      approvalTokenDifferentDm: "这个审批令牌属于另一个私聊。",
      noBridgeState: "这个私聊还没有记录任何 Codex bridge 状态。",
      noActiveTask: "当前没有活动任务。",
      lastLabel: "最近状态",
      bridgeError: (errorText) => `Codex bridge 错误：${errorText}`,
      executionRuntimeUnavailable: (errorText) => [
        "执行环境不兼容，任务未启动。",
        `原因：${errorText}`,
      ].join("\n"),
      directoryNotFound: (cwd) => `目录不存在：\`${cwd}\``,
      approvalTokenNotFound: (token) => `未找到审批令牌：${token}`,
      approvalTokenExpired: (token) => `审批令牌已过期：${token}`,
      cwdBlocked: (cwd) => `工作目录被 bridge 策略阻止：${cwd}`,
      malformedCodexCommand: (command) => [
        "命令前不要加多余前缀。",
        `请直接使用 \`${command}\`。`,
      ].join("\n"),
      help: (_cwd) => getNativeHelpLines(normalized).join("\n"),
      unknownCommand: (_command, _cwd) => getNativeHelpLines(normalized).join("\n"),
      doctorSummary: ({ codex, bridge, runtime, codexVersion, bwrapVersion, feishu, gateway, runtimeMessage, nextStep }) => [
        "健康摘要",
        `Codex：${codex}`,
        `Bridge：${bridge}`,
        `运行时：${runtime}`,
        `Codex CLI：${codexVersion}`,
        `bwrap：${bwrapVersion}`,
        `Feishu 凭据：${feishu}`,
        `Gateway：${gateway}`,
        ...(runtimeMessage ? [`原因：${runtimeMessage}`] : []),
        `下一步：${nextStep}`,
      ].join("\n"),
      taskAlreadyRunning: (input, status) => {
        const details = getActiveTaskDetails(input, status);
        return [
          `已有活动任务：${details.taskId}`,
          ...(details.status ? [`状态：${localizeTaskStatus(normalized, details.status)}`] : []),
          ...(details.code ? [`代码：${details.code}`] : []),
          getActiveTaskActionLine(normalized, details),
          getActiveTaskFallbackLine(normalized, details),
        ].filter(Boolean).join("\n");
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
        "可直接回复“同意”批准，回复“不要执行”拒绝。",
        "如需补充要求，也可以回复“同意，并……”。",
      ].join("\n"),
      taskStarted: (task) => [
        "Codex 任务已启动。",
        `任务 ID：${task.taskId}`,
        `工作目录：\`${task.cwd}\``,
        `模式：${localizeMode(normalized, task.mode)}`,
        `风险：${localizeRisk(normalized, task.riskLevel)}`,
        ...(task.sessionId ? [`会话 ID：${task.sessionId}`] : []),
      ].join("\n"),
      taskProgress: (taskId, hint) => [`任务 ${taskId} 进度`, getUserVisibleStatusHint(normalized, hint)].join("\n"),
      taskStillRunning: (_taskId, elapsed, suffix) => `任务运行中（${elapsed}）。${suffix}`,
      activeTaskLine: (taskId) => `活动任务：${taskId}`,
      statusLine: (status) => `状态：${localizeTaskStatus(normalized, status)}`,
      cwdLine: (cwd) => `工作目录：\`${cwd}\``,
      modeLine: (mode) => `模式：${localizeMode(normalized, mode)}`,
      riskLine: (risk) => `风险：${localizeRisk(normalized, risk)}`,
      accessModeLine: (accessMode) =>
        accessMode === "full_access"
          ? `默认权限：${localizeAccessMode(normalized, accessMode)}（表示后续任务默认以高权限启动；宿主 GPU / systemd 等能力仍取决于当前运行时）`
          : `默认权限：${localizeAccessMode(normalized, accessMode)}`,
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
        if (task.deliveryFailureHint) {
          lines.push("");
          lines.push(task.deliveryFailureHint);
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
    usageNativeNew: getNativeUsageNew(normalized),
    usageNativeResume: getNativeUsageResume(normalized),
    noPreviousSession: "No active task to continue.",
    noActiveTaskToContinue: "No active task to continue.",
    noPendingApproval: "No active task awaiting approval.",
    nativeOptionMissingValue: (option, usage) => [`Missing a value for \`${option}\`.`, usage].join("\n"),
    nativeOptionInvalidValue: (option, value, allowedValues) => [
      `Invalid value for \`${option}\`: \`${value}\`.`,
      `Allowed values: ${allowedValues.map((entry) => `\`${entry}\``).join(", ")}`,
    ].join("\n"),
    nativeUnknownOption: (option) => [
      `This native-style option is not supported here yet: \`${option}\`.`,
      "This `/codex` bridge currently forwards these explicit start flags: `--cd`, `--model`, `--reasoning`, `--sandbox`, and `--ask-for-approval`.",
    ].join("\n"),
    bridgeActionBlockedByRunningTask: "The current Codex task is still running. Wait for it to finish before this control-plane action.",
    bridgeActionAlreadyRunning: "A control-plane action is already running. Wait for it to finish before starting another one.",
    bridgeActionApprovalNeedsPureApprove: "This step accepts only a pure approval reply. Reply with “approve” or “do not run”.",
    bridgeActionDenied: "This control-plane action was canceled.",
    bridgeActionLine: (status) => `control_plane: ${localizeTaskStatus(normalized, status)}`,
    bridgeActionApprovalStillPending: ({ token, reasons = [] }) => [
      "This step is still waiting for explicit approval.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      'Reply with “approve” to allow it, or “do not run” to deny it.',
    ].join("\n"),
    bridgeActionApprovalQueued: ({ token, reasons = [] }) => [
      "This step is queued for approval.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      'Reply with “approve” to allow it, or “do not run” to deny it.',
    ].join("\n"),
    bridgeActionFinished: ({ summary = "", resultStatus = "completed", error = null }) => {
      if (summary) return summary;
      if (resultStatus === "denied") return "This control-plane action was canceled.";
      if (resultStatus === "failed") return error ? `Control-plane action failed: ${error}` : "Control-plane action failed.";
      return "Control-plane action completed.";
    },
    approvalStillPending: ({ token, reasons = [] }) => [
      "This step is still waiting for explicit approval.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      'Reply with “approve” to allow it, or “do not run” to deny it.',
      'You can also reply with “approve, …” to add follow-up instructions.',
    ].join("\n"),
    approvalTailScopeChanged: ({ token, reasons = [] }) => [
      "The follow-up tail exceeds the scope of this approval, so the original approval stays pending.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      "Send the extra request as a new message, or reply with a pure approval for the already-approved step.",
    ].join("\n"),
    approvalGrantScopeChanged: ({ token, reasons = [] }) => [
      "The run boundary tied to this approval has changed, so the original approval stays pending.",
      ...reasons.map((reason) => formatReasonLine(normalized, reason)),
      "Please re-send this step, or cancel the current approval before retrying.",
    ].join("\n"),
    approvalDeniedAwaitingReplan: "This high-risk action was denied. The task is back in a safe replanning state.",
    approvalDeniedTaskAborted: "This high-risk action was denied. The current task was aborted.",
    approvalTokenConsumed: (token) => `This approval token was already consumed and cannot be used again: ${token}`,
    interruptedTaskRequiresContinue: (taskId, hint = "run.interrupted") => [
      `Previous run interrupted for task ${taskId}.`,
      getUserVisibleStatusHint(normalized, hint),
      `If needed, you can also use \`${getDefaultResumeCommand(normalized)}\`.`,
    ].join("\n"),
    approvalTokenDifferentDm: "This approval token belongs to a different DM.",
    noBridgeState: "No Codex bridge state recorded for this DM.",
    noActiveTask: "No active task.",
    lastLabel: "last",
    bridgeError: (errorText) => `Codex bridge error: ${errorText}`,
    executionRuntimeUnavailable: (errorText) => [
      "Execution runtime incompatible; task not started.",
      `Reason: ${errorText}`,
    ].join("\n"),
    directoryNotFound: (cwd) => `Directory not found: \`${cwd}\``,
    approvalTokenNotFound: (token) => `Approval token not found: ${token}`,
    approvalTokenExpired: (token) => `Approval token expired: ${token}`,
    cwdBlocked: (cwd) => `cwd is blocked by bridge policy: ${cwd}`,
    malformedCodexCommand: (command) => [
      "Do not prefix Codex commands with extra punctuation.",
      `Use \`${command}\` directly.`,
    ].join("\n"),
    help: (_cwd) => getNativeHelpLines(normalized).join("\n"),
    unknownCommand: (_command, _cwd) => getNativeHelpLines(normalized).join("\n"),
    doctorSummary: ({ codex, bridge, runtime, codexVersion, bwrapVersion, feishu, gateway, runtimeMessage, nextStep }) => [
      "Health Summary",
      `Codex: ${codex}`,
      `Bridge: ${bridge}`,
      `Runtime: ${runtime}`,
      `Codex CLI: ${codexVersion}`,
      `bwrap: ${bwrapVersion}`,
      `Feishu credentials: ${feishu}`,
      `Gateway: ${gateway}`,
      ...(runtimeMessage ? [`Reason: ${runtimeMessage}`] : []),
      `Next: ${nextStep}`,
    ].join("\n"),
    taskAlreadyRunning: (input, status) => {
      const details = getActiveTaskDetails(input, status);
      return [
        `Task already active: ${details.taskId}`,
        ...(details.status ? [`Status: ${localizeTaskStatus(normalized, details.status)}`] : []),
        ...(details.code ? [`Code: ${details.code}`] : []),
        getActiveTaskActionLine(normalized, details),
        getActiveTaskFallbackLine(normalized, details),
      ].filter(Boolean).join("\n");
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
      'Reply with “approve” to allow it, or “do not run” to deny it.',
      'You can also reply with “approve, …” to add follow-up instructions.',
    ].join("\n"),
    taskStarted: (task) => [
      "Codex task started.",
      `task_id: ${task.taskId}`,
      `cwd: \`${task.cwd}\``,
      `mode: ${localizeMode(normalized, task.mode)}`,
      `risk: ${localizeRisk(normalized, task.riskLevel)}`,
      ...(task.sessionId ? [`session_id: ${task.sessionId}`] : []),
    ].join("\n"),
    taskProgress: (taskId, hint) => [`Task ${taskId} progress`, getUserVisibleStatusHint(normalized, hint)].join("\n"),
    taskStillRunning: (_taskId, elapsed, suffix) => `Running (${elapsed}).${suffix}`,
    activeTaskLine: (taskId) => `Active task: ${taskId}`,
    statusLine: (status) => `status: ${localizeTaskStatus(normalized, status)}`,
    cwdLine: (cwd) => `cwd: \`${cwd}\``,
    modeLine: (mode) => `mode: ${localizeMode(normalized, mode)}`,
    riskLine: (risk) => `risk: ${localizeRisk(normalized, risk)}`,
    accessModeLine: (accessMode) =>
      accessMode === "full_access"
        ? `default access: ${localizeAccessMode(normalized, accessMode)} (future tasks default to high-risk mode; host GPU/systemd capability still depends on the runtime)`
        : `default access: ${localizeAccessMode(normalized, accessMode)}`,
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
    if (task.deliveryFailureHint) {
      lines.push("");
      lines.push(task.deliveryFailureHint);
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
