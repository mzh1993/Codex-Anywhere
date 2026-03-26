import test from "node:test";
import assert from "node:assert/strict";
import { getLocaleText } from "../lib/locale.js";
import {
  finishApprovalTransition,
  routeApproveCommand,
  routeAbortCommand,
  routeContinueCommand,
  routeIncomingPlainText,
  routePlainTextWithActiveTask,
  startNextRunFromApproval,
} from "../lib/task-model.js";
import { classifyOwnedBridgeActionRequest } from "../lib/policy.js";

test("protocol/input/no_task: plain text starts a new task when there is no active task", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: null }), {
    action: "create_task",
  });
});

test("protocol/input/awaiting_input: plain text auto-continues only when task is awaiting_input", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "awaiting_input" }), {
    action: "continue_task",
  });
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "awaiting_input", activeTaskOwner: "codex" }), {
    action: "continue_task",
  });
  assert.deepEqual(
    routeIncomingPlainText({ activeTaskStatus: "awaiting_input", requiresExplicitContinue: true }),
    {
      action: "continue_task",
    },
  );
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "running" }), {
    action: "reject",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });
});

test("protocol/input/approval_owner: bridge-owned approval replies are routed to approval handling first", () => {
  assert.deepEqual(
    routeIncomingPlainText({
      activeTaskStatus: "awaiting_approval",
      activeTaskOwner: "bridge_approval",
    }),
    {
      action: "handle_approval_reply",
    },
  );
});

test("protocol/input/bridge_action: repository-owned service control is classified as a bridge action", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "请重启 openclaw-codex-feishu.service",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "service_control",
      operation: "restart",
      target: "openclaw-codex-feishu.service",
      requiresApproval: true,
      reasonCodes: ["service_control_requires_approval"],
    },
  );
});

test("protocol/input/bridge_action: repository-owned gateway health checks stay bridge-owned and read-only", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "请帮我检查 gateway 健康状态",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "gateway_health",
      operation: "check",
      target: "gateway",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: non-owned host operations are not hijacked by the bridge", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "请重启 nginx",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "请 docker restart xxx",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: mixed repository-owned control plus normal work falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "请帮我重启 openclaw-codex-feishu.service 并总结 README.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: shorthand repository viewing after gateway health falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show gateway health details view repository",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: shorthand repository viewing after owned service status falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "what is the status of openclaw-codex-feishu.service view repo",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: english natural-language status checks for owned service stay bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "what is the status of openclaw-codex-feishu.service",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "service_control",
      operation: "status",
      target: "openclaw-codex-feishu.service",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: english natural-language gateway health checks stay bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "can you check the health of gateway",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "gateway_health",
      operation: "check",
      target: "gateway",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: english natural-language gateway health details stay bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "show gateway health details",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "gateway_health",
      operation: "check",
      target: "gateway",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: english natural-language diagnostics stay bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "please check bridge diagnostic info",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "diagnostic",
      operation: "gateway-status",
      target: "bridge",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: english natural-language diagnostic details stay bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "show me bridge diagnostic details",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "diagnostic",
      operation: "gateway-status",
      target: "bridge",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: reversed english diagnostic details phrasing stays bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "show diagnostic details of bridge",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "diagnostic",
      operation: "gateway-status",
      target: "bridge",
      requiresApproval: false,
      reasonCodes: [],
    },
  );
});

test("protocol/input/bridge_action: ambiguous status info phrasing stays codex-owned", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show status info of bridge",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show status info of gateway",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show status info of runner",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: english natural-language install lifecycle stays bridge-owned", () => {
  assert.deepEqual(
    classifyOwnedBridgeActionRequest({
      prompt: "can you install the systemd service",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    {
      kind: "install_lifecycle",
      operation: "install-systemd",
      target: "systemd",
      requiresApproval: true,
      reasonCodes: ["install_lifecycle_requires_approval"],
    },
  );
});

test("protocol/input/bridge_action: diagnostic details mixed with normal work still fall back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show me bridge diagnostic details and summarize README.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: reversed diagnostic details mixed with normal work still fall back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show diagnostic details of bridge and summarize README.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: gateway health details mixed with normal work still fall back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show gateway health details and summarize README.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: diagnostic details plus explanation work still fall back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show bridge diagnostic details and explain README structure",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: install lifecycle plus docs update still falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "install the systemd service and then update docs/roadmap.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: owned service status plus test fixing still falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "status of openclaw-codex-feishu.service, then fix the failing test",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: gateway health with trailing ordinary verb falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show gateway health details view",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: diagnostic details with trailing ordinary verb falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "show bridge diagnostic details info",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/input/bridge_action: owned service status with trailing ordinary verb falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "what is the status of openclaw-codex-feishu.service check",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});

test("protocol/command/continue: continue is rejected when no active task exists", () => {
  const result = routeContinueCommand({ activeTaskStatus: null });
  assert.deepEqual(result, {
    accepted: false,
    code: "no_active_task",
  });
});

test("protocol/command/continue: continue requires the task to be waiting for input", () => {
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: true,
    action: "create_next_run",
  });
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "running" }), {
    accepted: false,
    code: "task_not_waiting_input",
    suggestedCommand: "/codex status",
  });
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "awaiting_approval" }), {
    accepted: false,
    code: "task_not_waiting_input",
    suggestedCommand: "/codex approve <token>",
  });
});

test("protocol/input/running: plain text with an active task does not implicitly continue", () => {
  const result = routePlainTextWithActiveTask({ activeTaskStatus: "running" });
  assert.deepEqual(result, {
    accepted: false,
    code: "active_task_exists",
    suggestedCommand: "/codex continue <prompt>",
  });
});

test("protocol/locale/continue: continue guidance text targets the current active task", () => {
  const en = getLocaleText("en-US");
  const zh = getLocaleText("zh-CN");

  assert.match(en.help("/tmp"), /`\/codex continue <prompt>` fallback for explicit continue/);
  assert.match(zh.help("/tmp"), /`\/codex continue <prompt>` 兜底用于显式续写/);
  assert.equal(en.noActiveTaskToContinue, "No active task to continue.");
  assert.equal(zh.noActiveTaskToContinue, "当前没有可继续的活动任务。");
});

test("protocol/locale/recovery: interruption guidance keeps natural language as the main path", () => {
  const en = getLocaleText("en-US");
  const zh = getLocaleText("zh-CN");

  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /请直接说明要继续做什么/);
  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /也可以使用 `\/codex continue <prompt>`/);
  assert.doesNotMatch(zh.interruptedTaskRequiresContinue("task-1"), /请使用 `\/codex continue <prompt>`/);

  assert.match(en.interruptedTaskRequiresContinue("task-1"), /Say what to continue with/);
  assert.match(en.interruptedTaskRequiresContinue("task-1"), /you can also use `\/codex continue <prompt>`/i);
  assert.doesNotMatch(en.interruptedTaskRequiresContinue("task-1"), /^Use `\/codex continue <prompt>`/m);
});

test("protocol/locale/status: running-task guidance does not mislabel status as a continue command", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.taskAlreadyRunning({
    taskId: "task-1",
    status: "running",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });

  assert.match(text, /请先使用 `\/codex status`/);
  assert.doesNotMatch(text, /`\/codex status` 提交明确的继续输入/);
});

test("protocol/locale/status: running-task guidance does not repeat the same status command twice", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.taskAlreadyRunning({
    taskId: "task-1",
    status: "running",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });

  assert.equal(text.match(/\/codex status/g)?.length ?? 0, 1);
  assert.match(text, /`\/codex abort`/);
});

test("protocol/locale/approval: queued approval text keeps natural language as the primary path", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.approvalQueued({
    token: "TOKEN1",
    mode: "new",
    cwd: "/repo",
    reasons: ["service_control_requires_approval"],
  });

  assert.match(text, /直接回复“同意”批准/);
  assert.match(text, /回复“不要执行”拒绝/);
  assert.match(text, /`\/codex approve TOKEN1`/);
});

test("protocol/locale/approval: keep-gate-open text explains approval without authorizing", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.approvalStillPending({
    token: "TOKEN1",
    reasons: ["service_control_requires_approval"],
  });

  assert.match(text, /等待你的明确审批/);
  assert.match(text, /直接回复“同意”/);
  assert.match(text, /“不要执行”/);
  assert.match(text, /`\/codex approve TOKEN1`/);
});

test("protocol/transition/approval: approval-required decision transitions task to awaiting_approval", () => {
  const next = finishApprovalTransition({ currentStatus: "running", decision: "approval_required" });
  assert.equal(next.status, "awaiting_approval");
});

test("protocol/transition/approval: approval starts the next run instead of resuming the blocked run", () => {
  assert.deepEqual(startNextRunFromApproval(), {
    taskStatus: "running",
    action: "create_next_run",
  });
});

test("protocol/command/approve: approve requires the task to be waiting for approval", () => {
  assert.deepEqual(routeApproveCommand({ activeTaskStatus: "awaiting_approval" }), {
    accepted: true,
    action: "approve_pending_request",
  });
  assert.deepEqual(routeApproveCommand({ activeTaskStatus: null }), {
    accepted: false,
    code: "no_pending_approval",
  });
  assert.deepEqual(routeApproveCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: false,
    code: "task_not_waiting_approval",
    suggestedCommand: "/codex continue <prompt>",
  });
  assert.deepEqual(routeApproveCommand({ activeTaskStatus: "running" }), {
    accepted: false,
    code: "task_not_waiting_approval",
    suggestedCommand: "/codex status",
  });
});

test("protocol/command/abort: abort is allowed for any active task and rejected without one", () => {
  assert.deepEqual(routeAbortCommand({ activeTaskStatus: null }), {
    accepted: false,
    code: "no_active_task",
  });
  assert.deepEqual(routeAbortCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: true,
    action: "abort_task",
  });
  assert.deepEqual(routeAbortCommand({ activeTaskStatus: "running" }), {
    accepted: true,
    action: "abort_task",
  });
  assert.deepEqual(routeAbortCommand({ activeTaskStatus: "awaiting_approval" }), {
    accepted: true,
    action: "abort_task",
  });
});
