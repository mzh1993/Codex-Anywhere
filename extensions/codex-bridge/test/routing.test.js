import test from "node:test";
import assert from "node:assert/strict";
import { getLocaleText } from "../lib/locale.js";
import {
  finishApprovalTransition,
  routeResumeCommand,
  routeIncomingPlainText,
  routePlainTextWithActiveTask,
  startNextRunFromApproval,
} from "../lib/task-model.js";
import { assessOwnedBridgeActionRequest, classifyOwnedBridgeActionRequest } from "../lib/policy.js";

const BRIDGE_SERVICE_UNIT_NAMES = ["openclaw-codex-feishu.service"];

const RESTART_OWNED_SERVICE = {
  kind: "service_control",
  operation: "restart",
  target: "openclaw-codex-feishu.service",
  requiresApproval: true,
  reasonCodes: ["service_control_requires_approval"],
};

const READ_ONLY_OWNED_SERVICE_STATUS = {
  kind: "service_control",
  operation: "status",
  target: "openclaw-codex-feishu.service",
  requiresApproval: false,
  reasonCodes: [],
};

const READ_ONLY_GATEWAY_HEALTH = {
  kind: "gateway_health",
  operation: "check",
  target: "gateway",
  requiresApproval: false,
  reasonCodes: [],
};

const READ_ONLY_BRIDGE_DIAGNOSTIC = {
  kind: "diagnostic",
  operation: "gateway-status",
  target: "bridge",
  requiresApproval: false,
  reasonCodes: [],
};

const INSTALL_SYSTEMD_SERVICE = {
  kind: "install_lifecycle",
  operation: "install-systemd",
  target: "systemd",
  requiresApproval: true,
  reasonCodes: ["install_lifecycle_requires_approval"],
};

function classifyBridgeAction(prompt) {
  return classifyOwnedBridgeActionRequest({
    prompt,
    bridgeServiceUnitNames: BRIDGE_SERVICE_UNIT_NAMES,
  });
}

function assessBridgeAction(prompt) {
  return assessOwnedBridgeActionRequest({
    prompt,
    bridgeServiceUnitNames: BRIDGE_SERVICE_UNIT_NAMES,
  });
}

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

test("protocol/lane_contract/service_control: dedicated owned service prompts stay bridge-owned", () => {
  const restart = assessBridgeAction("请重启 openclaw-codex-feishu.service");
  assert.equal(restart.capability, "bridge_control");
  assert.equal(restart.effectKind, "service_control");
  assert.equal(restart.routing.dedicatedRequest, true);
  assert.equal(restart.routing.ambiguousCapability, false);
  assert.equal(restart.routing.mixedIntent, false);
  assert.deepEqual(restart.decision, RESTART_OWNED_SERVICE);

  const status = assessBridgeAction("please report status of openclaw-codex-feishu.service");
  assert.equal(status.capability, "bridge_control");
  assert.equal(status.effectKind, "service_control");
  assert.equal(status.routing.dedicatedRequest, true);
  assert.deepEqual(status.decision, READ_ONLY_OWNED_SERVICE_STATUS);
});

test("protocol/lane_contract/control_plane_reads: representative dedicated control-plane reads stay bridge-owned", () => {
  assert.deepEqual(classifyBridgeAction("show gateway health details info"), READ_ONLY_GATEWAY_HEALTH);
  assert.deepEqual(classifyBridgeAction("show bridge diagnostic details info"), READ_ONLY_BRIDGE_DIAGNOSTIC);
  assert.deepEqual(classifyBridgeAction("install the repo systemd service"), INSTALL_SYSTEMD_SERVICE);
});

test("protocol/lane_contract/fallback: non-owned, mixed-intent, and ambiguous prompts fall back to codex", () => {
  assert.equal(classifyBridgeAction("请重启 nginx"), null);
  assert.equal(classifyBridgeAction("请帮我重启 openclaw-codex-feishu.service 并总结 README.md"), null);

  const mixed = assessBridgeAction("show gateway health details view repository");
  assert.equal(mixed.capability, "bridge_control");
  assert.equal(mixed.effectKind, "gateway_health");
  assert.equal(mixed.routing.dedicatedRequest, false);
  assert.equal(mixed.routing.mixedIntent, true);
  assert.equal(mixed.decision, null);

  const ambiguous = assessBridgeAction("show status info of bridge");
  assert.equal(ambiguous.capability, "bridge_control");
  assert.equal(ambiguous.routing.ambiguousCapability, true);
  assert.equal(ambiguous.decision, null);
});

test("protocol/resume_gate: explicit resume is rejected when no active task exists", () => {
  const result = routeResumeCommand({ activeTaskStatus: null });
  assert.deepEqual(result, {
    accepted: false,
    code: "no_active_task",
  });
});

test("protocol/resume_gate: explicit resume still requires the task to be waiting for input", () => {
  assert.deepEqual(routeResumeCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: true,
    action: "create_next_run",
  });
  assert.deepEqual(routeResumeCommand({ activeTaskStatus: "running" }), {
    accepted: false,
    code: "task_not_waiting_input",
  });
  assert.deepEqual(routeResumeCommand({ activeTaskStatus: "awaiting_approval" }), {
    accepted: false,
    code: "task_not_waiting_input",
  });
});

test("protocol/input/existing_task: plain text with an active task does not implicitly continue", () => {
  const result = routePlainTextWithActiveTask({ activeTaskStatus: "running" });
  assert.deepEqual(result, {
    accepted: false,
    code: "active_task_exists",
  });
});

test("protocol/locale/recovery: interruption guidance keeps natural language as the main path", () => {
  const en = getLocaleText("en-US");
  const zh = getLocaleText("zh-CN");

  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /请直接说明要继续做什么/);
  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /也可以使用 `\/codex resume <prompt>`/);
  assert.doesNotMatch(zh.interruptedTaskRequiresContinue("task-1"), /请使用 `\/codex resume <prompt>`/);

  assert.match(en.interruptedTaskRequiresContinue("task-1"), /Say what to continue with/);
  assert.match(en.interruptedTaskRequiresContinue("task-1"), /you can also use `\/codex resume <prompt>`/i);
  assert.doesNotMatch(en.interruptedTaskRequiresContinue("task-1"), /^Use `\/codex resume <prompt>`/m);
});

test("protocol/locale/status: running-task guidance does not mislabel status as a resume command", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.taskAlreadyRunning({
    taskId: "task-1",
    status: "running",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });

  assert.match(text, /当前任务仍在运行/);
  assert.doesNotMatch(text, /\/codex status/);
});

test("protocol/locale/status: running-task guidance does not repeat the same status command twice", () => {
  const zh = getLocaleText("zh-CN");
  const text = zh.taskAlreadyRunning({
    taskId: "task-1",
    status: "running",
    code: "active_task_exists",
    suggestedCommand: "/codex status",
  });

  assert.equal(text.match(/\/codex status/g)?.length ?? 0, 0);
  assert.doesNotMatch(text, /\/codex abort/);
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
  assert.doesNotMatch(text, /\/codex approve|\/codex status|\/codex abort/);
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
  assert.doesNotMatch(text, /\/codex approve|\/codex status|\/codex abort/);
});

test("protocol/locale/approval: bridge-action approval text also keeps closed legacy slash commands hidden by default", () => {
  const zh = getLocaleText("zh-CN");
  const queued = zh.bridgeActionApprovalQueued({
    token: "TOKEN1",
    reasons: ["service_control_requires_approval"],
  });
  const pending = zh.bridgeActionApprovalStillPending({
    token: "TOKEN1",
    reasons: ["service_control_requires_approval"],
  });

  assert.match(queued, /直接回复“同意”批准/);
  assert.match(pending, /直接回复“同意”批准/);
  assert.doesNotMatch(queued, /\/codex approve|\/codex status|\/codex abort/);
  assert.doesNotMatch(pending, /\/codex approve|\/codex status|\/codex abort/);
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

test("constitution/command/help: help stays native-first and excludes closed legacy slash commands", () => {
  const zh = getLocaleText("zh-CN");
  const en = getLocaleText("en-US");

  assert.doesNotMatch(zh.help("/tmp"), /Codex Runner 命令/);
  assert.doesNotMatch(zh.help("/tmp"), /bridge/i);
  assert.match(zh.help("/tmp"), /`\/codex doctor`/);
  assert.match(zh.help("/tmp"), /`\/codex --cd <path> --model <model> <prompt>`/);
  assert.doesNotMatch(zh.help("/tmp"), /兼容/);
  assert.doesNotMatch(zh.help("/tmp"), /`\/codex cwd <path>`|`\/codex pwd`|`\/codex continue <prompt>`/);

  assert.doesNotMatch(en.help("/tmp"), /Codex Runner commands/);
  assert.doesNotMatch(en.help("/tmp"), /bridge/i);
  assert.match(en.help("/tmp"), /`\/codex doctor`/);
  assert.match(en.help("/tmp"), /`\/codex --cd <path> --model <model> <prompt>`/);
  assert.doesNotMatch(en.help("/tmp"), /Compatibility/);
  assert.doesNotMatch(en.help("/tmp"), /`\/codex cwd <path>`|`\/codex pwd`|`\/codex continue <prompt>`/);
});
