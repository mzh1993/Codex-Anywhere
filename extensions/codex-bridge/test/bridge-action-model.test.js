import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIDGE_ACTION_KINDS,
  BRIDGE_ACTION_RESULT_STATUSES,
  BRIDGE_ACTION_STATUSES,
  canBridgeActionAffectTaskContinuity,
  defaultBridgeActionOwner,
  finishBridgeActionDenied,
  finishBridgeActionFromExecution,
  finishBridgeActionWithApprovalRequired,
  isBridgeActionStatus,
  normalizeBridgeActionOwner,
  startBridgeActionExecution,
} from "../lib/bridge-action-model.js";

test("protocol/bridge-action/schema: bridge action statuses, kinds, and result statuses stay narrow", () => {
  assert.deepEqual(BRIDGE_ACTION_STATUSES, ["created", "awaiting_approval", "running", "finished"]);
  assert.deepEqual(BRIDGE_ACTION_KINDS, ["service_control", "gateway_health", "install_lifecycle", "diagnostic"]);
  assert.deepEqual(BRIDGE_ACTION_RESULT_STATUSES, ["completed", "failed", "denied"]);
  assert.equal(isBridgeActionStatus("awaiting_approval"), true);
  assert.equal(isBridgeActionStatus("awaiting_input"), false);
});

test("protocol/bridge-action/owner: bridge action ownership stays bridge-only and never consumes task continuity", () => {
  assert.equal(defaultBridgeActionOwner("created"), "bridge_action");
  assert.equal(defaultBridgeActionOwner("awaiting_approval"), "bridge_approval");
  assert.equal(normalizeBridgeActionOwner("codex", "awaiting_approval"), "bridge_approval");
  assert.equal(normalizeBridgeActionOwner("bridge_approval", "running"), "bridge_action");
  assert.equal(canBridgeActionAffectTaskContinuity(), false);
});

test("protocol/bridge-action/transition: approval, deny, and execution outcomes remain task-independent", () => {
  assert.deepEqual(finishBridgeActionWithApprovalRequired(), {
    status: "awaiting_approval",
    owner: "bridge_approval",
    resultStatus: null,
  });

  assert.deepEqual(startBridgeActionExecution(), {
    status: "running",
    owner: "bridge_action",
    resultStatus: null,
  });

  assert.deepEqual(finishBridgeActionDenied(), {
    status: "finished",
    owner: "bridge_action",
    resultStatus: "denied",
  });

  assert.deepEqual(finishBridgeActionFromExecution({ exitCode: 0, error: null }), {
    status: "finished",
    owner: "bridge_action",
    resultStatus: "completed",
  });

  assert.deepEqual(finishBridgeActionFromExecution({ exitCode: 1, error: null }), {
    status: "finished",
    owner: "bridge_action",
    resultStatus: "failed",
  });

  assert.deepEqual(finishBridgeActionFromExecution({ exitCode: null, error: "boom" }), {
    status: "finished",
    owner: "bridge_action",
    resultStatus: "failed",
  });
});
