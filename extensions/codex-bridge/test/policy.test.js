import test from "node:test";
import assert from "node:assert/strict";
import { assessPolicyDecision, POLICY_DECISIONS } from "../lib/policy.js";
import { isPathInside, isPathInsideAny } from "../lib/fs-utils.js";

test("policy decision protocol values stay stable", () => {
  assert.deepEqual(POLICY_DECISIONS, {
    ALLOWED: "allowed",
    APPROVAL_REQUIRED: "approval_required",
    DENIED: "denied",
  });
});

test("protected runner state returns denied with a stable code", () => {
  const decision = assessPolicyDecision({
    prompt: "inspect logs",
    cwd: "/repo/.isolated/codex-feishu/state/codex-bridge",
    protectedRoots: ["/repo/.isolated/codex-feishu/state/codex-bridge"],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "denied");
  assert.deepEqual(decision.reasonCodes, ["isolation_boundary_denied"]);
});

test("service-control requests require approval", () => {
  const decision = assessPolicyDecision({
    prompt: "restart systemctl user service",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["service_control_requires_approval"]);
});

test("isolated gateway service control still requires approval instead of direct denial", () => {
  const decision = assessPolicyDecision({
    prompt: "请帮我重启 openclaw-codex-feishu.service",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["service_control_requires_approval"]);
});

test("host codex root access requires approval", () => {
  const decision = assessPolicyDecision({
    prompt: "list files",
    cwd: "/home/neousys/.codex/sessions",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["host_mutation_requires_approval"]);
});

test("write inside the controlled cwd stays allowed", () => {
  const decision = assessPolicyDecision({
    prompt: "write summary to ./notes/today.md",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "allowed");
  assert.deepEqual(decision.reasonCodes, []);
});

test("write to a bare relative path inside the controlled cwd stays allowed", () => {
  const decision = assessPolicyDecision({
    prompt: "write summary to notes/today.md",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "allowed");
  assert.deepEqual(decision.reasonCodes, []);
});

test("write to host path outside the controlled cwd requires approval", () => {
  const decision = assessPolicyDecision({
    prompt: "write summary to /home/neousys/Desktop/today.md",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["host_mutation_requires_approval"]);
});

test("write to parent path outside the controlled cwd requires approval", () => {
  const decision = assessPolicyDecision({
    prompt: "append result into ../shared/result.txt",
    cwd: "/home/neousys/project/worktree",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["host_mutation_requires_approval"]);
});

test("write to protected host state is denied", () => {
  const decision = assessPolicyDecision({
    prompt: "请修改 ~/.openclaw/config.json",
    cwd: "/home/neousys/project",
    protectedRoots: ["/home/neousys/.openclaw", "/repo/.isolated/codex-feishu/state/codex-bridge"],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "denied");
  assert.deepEqual(decision.reasonCodes, ["isolation_boundary_denied"]);
});

test("global environment changes require approval", () => {
  const decision = assessPolicyDecision({
    prompt: "npm install -g pnpm",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["global_env_change_requires_approval"]);
});

test("destructive commands require approval", () => {
  const decision = assessPolicyDecision({
    prompt: "rm -rf /tmp/demo",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["destructive_change_requires_approval"]);
});

test("benign prompts are allowed", () => {
  const decision = assessPolicyDecision({
    prompt: "show README",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "allowed");
  assert.deepEqual(decision.reasonCodes, []);
});

test("empty or whitespace-only candidate paths are rejected", () => {
  assert.equal(isPathInside("", process.cwd()), false);
  assert.equal(isPathInside("   ", process.cwd()), false);
  assert.equal(isPathInsideAny("", [process.cwd()]), false);
  assert.equal(isPathInsideAny("   ", [process.cwd()]), false);
});

test("empty or whitespace-only root paths are rejected", () => {
  assert.equal(isPathInside(process.cwd(), ""), false);
  assert.equal(isPathInside(process.cwd(), "   "), false);
});

test("root path matching treats slash as ancestor of all absolute paths", () => {
  assert.equal(isPathInside("/", "/"), true);
  assert.equal(isPathInside("/tmp", "/"), true);
});
