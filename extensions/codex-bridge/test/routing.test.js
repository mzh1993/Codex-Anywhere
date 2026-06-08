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

const NO_ANGLE_PLACEHOLDER_RE = /<path>|<prompt>|<model>|<level>|<policy>/;
const ZH_NEW_TASK_EXAMPLE_RE = /`\/codex --cd \. 帮我看看当前目录`/;
const ZH_FULL_ACCESS_EXAMPLE_RE = /`\/codex --cd \. --sandbox danger-full-access 帮我看看当前目录`/;
const ZH_RESUME_EXAMPLE_RE = /`\/codex resume 继续`/;
const ZH_OPTIONAL_FLAGS_EXAMPLE_RE = /`--model gpt-5\.2` `--reasoning medium` `--ask-for-approval never`/;
const ZH_DEFAULT_CWD_TEXT_RE = /默认工作目录：当前私聊最近一次目录；若没有，则使用默认目录（通常是当前用户主目录）/;
const EN_NEW_TASK_EXAMPLE_RE = /`\/codex --cd \. summarize the current directory`/;
const EN_FULL_ACCESS_EXAMPLE_RE =
  /`\/codex --cd \. --sandbox danger-full-access summarize the current directory`/;
const EN_RESUME_EXAMPLE_RE = /`\/codex resume continue`/;
const EN_OPTIONAL_FLAGS_EXAMPLE_RE = /`--model gpt-5\.2` `--reasoning medium` `--ask-for-approval never`/;
const EN_DEFAULT_CWD_TEXT_RE =
  /Default cwd: most recent cwd in this DM; otherwise the default directory \(usually the current user's home directory\)\./;

function assertZhNativeShortHelp(text) {
  assert.match(text, /默认直接发送自然语言给 Codex/);
  assert.match(text, /继续当前工作：直接回复下一步给 Codex/);
  assert.match(text, ZH_NEW_TASK_EXAMPLE_RE);
  assert.match(text, ZH_FULL_ACCESS_EXAMPLE_RE);
  assert.match(text, ZH_RESUME_EXAMPLE_RE);
  assert.doesNotMatch(text, /^续写：`\/codex resume 继续`$/m);
  assert.match(text, ZH_OPTIONAL_FLAGS_EXAMPLE_RE);
  assert.match(text, /`\/codex doctor`/);
  assert.match(text, ZH_DEFAULT_CWD_TEXT_RE);
  assert.doesNotMatch(text, NO_ANGLE_PLACEHOLDER_RE);
}

function assertEnNativeShortHelp(text) {
  assert.match(text, /For normal work, just send a plain message to Codex/);
  assert.match(text, /To continue current work, reply directly with the next step for Codex/);
  assert.match(text, EN_NEW_TASK_EXAMPLE_RE);
  assert.match(text, EN_FULL_ACCESS_EXAMPLE_RE);
  assert.match(text, EN_RESUME_EXAMPLE_RE);
  assert.doesNotMatch(text, /^Resume: `\/codex resume continue`$/m);
  assert.match(text, EN_OPTIONAL_FLAGS_EXAMPLE_RE);
  assert.match(text, /`\/codex doctor`/);
  assert.match(text, EN_DEFAULT_CWD_TEXT_RE);
  assert.doesNotMatch(text, NO_ANGLE_PLACEHOLDER_RE);
}

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

  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /请直接回复下一步给 Codex/);
  assert.match(zh.interruptedTaskRequiresContinue("task-1"), /也可以使用 `\/codex resume 继续`/);
  assert.doesNotMatch(zh.interruptedTaskRequiresContinue("task-1"), /请使用 `\/codex resume 继续`/);
  assert.doesNotMatch(zh.interruptedTaskRequiresContinue("task-1"), NO_ANGLE_PLACEHOLDER_RE);

  assert.match(en.interruptedTaskRequiresContinue("task-1"), /Reply directly with the next step for Codex/);
  assert.match(en.interruptedTaskRequiresContinue("task-1"), /you can also use `\/codex resume continue`/i);
  assert.doesNotMatch(en.interruptedTaskRequiresContinue("task-1"), /^Use `\/codex resume continue`/m);
  assert.doesNotMatch(en.interruptedTaskRequiresContinue("task-1"), NO_ANGLE_PLACEHOLDER_RE);
});

test("protocol/locale/status: awaiting-input guidance teaches direct reply first and keeps resume as fallback", () => {
  const zh = getLocaleText("zh-CN");
  const en = getLocaleText("en-US");

  const zhText = zh.taskAlreadyRunning({
    taskId: "task-1",
    status: "awaiting_input",
    code: "active_task_exists",
  });
  assert.match(zhText, /直接回复/);
  assert.match(zhText, /如需兜底，也可以使用 `\/codex resume 继续`/);
  assert.doesNotMatch(zhText, /请先使用 `\/codex resume 继续`/);

  const enText = en.taskAlreadyRunning({
    taskId: "task-1",
    status: "awaiting_input",
    code: "active_task_exists",
  });
  assert.match(enText, /reply directly/i);
  assert.match(enText, /If needed, you can also use `\/codex resume continue` as a fallback/);
  assert.doesNotMatch(enText, /Use `\/codex resume continue` to handle the current task first/);
});

test("protocol/locale/finish: awaiting-input finish text keeps run-level continuity language", () => {
  const zh = getLocaleText("zh-CN");
  const en = getLocaleText("en-US");

  const zhCompleted = zh.taskFinished({
    taskId: "task-1",
    cwd: "/repo",
    status: "awaiting_input",
    runStatus: "completed",
    nextSteps: [],
    summary: "",
    error: null,
  });
  assert.match(zhCompleted, /本轮执行已完成：task-1/);
  assert.match(zhCompleted, /状态：等待输入/);
  assert.doesNotMatch(zhCompleted, /Codex 任务已完成/);

  const enFailed = en.taskFinished({
    taskId: "task-2",
    cwd: "/repo",
    status: "awaiting_input",
    runStatus: "failed",
    nextSteps: [],
    summary: "",
    error: null,
  });
  assert.match(enFailed, /Codex run failed: task-2/);
  assert.match(enFailed, /status: awaiting_input/);
  assert.doesNotMatch(enFailed, /Codex task failed/);
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

test("constitution/locale/unknown_command: closed legacy commands fall back to the same short help examples", () => {
  const zh = getLocaleText("zh-CN");
  const en = getLocaleText("en-US");

  assert.equal(zh.unknownCommand("/codex status", "/tmp"), zh.help("/tmp"));
  assertZhNativeShortHelp(zh.unknownCommand("/codex status", "/tmp"));
  assert.doesNotMatch(zh.unknownCommand("/codex status", "/tmp"), /已关闭|不再执行|暂不支持/);
  assert.doesNotMatch(zh.unknownCommand("/codex status", "/tmp"), /\/tmp/);

  assert.equal(en.unknownCommand("/codex status", "/tmp"), en.help("/tmp"));
  assertEnNativeShortHelp(en.unknownCommand("/codex status", "/tmp"));
  assert.doesNotMatch(en.unknownCommand("/codex status", "/tmp"), /closed|no longer executed|not supported here yet/i);
  assert.doesNotMatch(en.unknownCommand("/codex status", "/tmp"), /\/tmp/);
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
  assertZhNativeShortHelp(zh.help("/tmp"));
  assert.doesNotMatch(zh.help("/tmp"), /兼容/);
  assert.doesNotMatch(zh.help("/tmp"), /`\/codex cwd .+`|`\/codex pwd`|`\/codex continue .+`/);
  assert.doesNotMatch(zh.help("/tmp"), /\/tmp/);

  assert.doesNotMatch(en.help("/tmp"), /Codex Runner commands/);
  assert.doesNotMatch(en.help("/tmp"), /bridge/i);
  assertEnNativeShortHelp(en.help("/tmp"));
  assert.doesNotMatch(en.help("/tmp"), /Compatibility/);
  assert.doesNotMatch(en.help("/tmp"), /`\/codex cwd .+`|`\/codex pwd`|`\/codex continue .+`/);
  assert.doesNotMatch(en.help("/tmp"), /\/tmp/);
});
