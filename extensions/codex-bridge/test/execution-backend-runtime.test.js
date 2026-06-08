import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createFakeApi(stateDir, pluginConfigOverrides = {}) {
  return {
    pluginConfig: {
      locale: "zh-CN",
      heartbeatMs: 1000,
      statusThrottleMs: 0,
      codexHome: path.join(stateDir, "codex-home"),
      ...pluginConfigOverrides,
    },
    config: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    runtime: {
      config: {
        loadConfig() {
          return { gateway: { stateDir } };
        },
      },
      state: {
        resolveStateDir() {
          return stateDir;
        },
      },
      channel: {
        pairing: {
          async readAllowFromStore() {
            return ["*"];
          },
        },
      },
    },
  };
}

function renderReplyText(params) {
  if (params?.text) return params.text;
  const elements = Array.isArray(params?.card?.elements) ? params.card.elements : [];
  return elements
    .map((element) => (element?.tag === "markdown" ? element.content : ""))
    .filter(Boolean)
    .join("\n");
}

async function cleanupActiveTaskRuntimes(activeTaskMap) {
  for (const runtime of activeTaskMap.values()) {
    if (runtime?.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
    if (runtime?.sessionPollTimer) clearInterval(runtime.sessionPollTimer);
    runtime?.child?.kill?.();
  }
  activeTaskMap.clear();
}

async function createBridgeHarness(tempRoot, options = {}) {
  const pluginConfig = options.pluginConfig ?? {};
  const { CodexBridge } = await import("../index.js");
  const replies = [];
  const bridge = new CodexBridge(createFakeApi(tempRoot, pluginConfig));
  bridge.safeReply = async (params) => {
    const prepared = bridge.prepareReply(params);
    replies.push(renderReplyText(prepared));
  };
  bridge.ensureCodexHome = async () => {};
  bridge.snapshotSessionFiles = async () => new Set();
  return { bridge, replies };
}

test("runtime/settings/execution_backend: defaults to cli and allows explicit ws config", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-settings-backend-"));
  const { bridge: defaultBridge } = await createBridgeHarness(tempRoot);

  assert.equal(defaultBridge.settings.executionBackend, "cli");
  assert.equal(defaultBridge.settings.wsBackendAutoFallbackToCli, true);
  assert.equal(defaultBridge.settings.wsBackendUrl, "ws://127.0.0.1:18766");

  const { bridge: wsBridge } = await createBridgeHarness(tempRoot, {
    pluginConfig: {
      executionBackend: "ws",
      wsBackendUrl: "ws://127.0.0.1:19999",
      wsBackendAuthTokenEnv: "CODEX_WS_BACKEND_TOKEN",
      wsBackendAutoFallbackToCli: false,
    },
  });

  assert.equal(wsBridge.settings.executionBackend, "ws");
  assert.equal(wsBridge.settings.wsBackendUrl, "ws://127.0.0.1:19999");
  assert.equal(wsBridge.settings.wsBackendAuthTokenEnv, "CODEX_WS_BACKEND_TOKEN");
  assert.equal(wsBridge.settings.wsBackendAutoFallbackToCli, false);
});

test("runtime/execution_backend/fallback: ws start failure falls back to cli when enabled", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-ws-fallback-enabled-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot, {
    pluginConfig: {
      codexBin: "/bin/true",
      executionBackend: "ws",
      wsBackendUrl: "http://127.0.0.1:18766",
      wsBackendAutoFallbackToCli: true,
      heartbeatMs: 60_000,
    },
  });
  const { __activeTasks } = await import("../index.js");

  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });
  bridge.finishTask = async () => {};

  await bridge.startTask({
    profile: {
      senderId: "user-ws-fallback",
      accountId: "default",
      conversationId: "conv-ws-fallback",
      defaultCwd: tempRoot,
      updatedAt: "2026-04-17T00:00:00.000Z",
    },
    accountId: "default",
    conversationId: "conv-ws-fallback",
    messageId: "msg-ws-fallback",
    mode: "new",
    prompt: "test ws fallback",
    cwd: tempRoot,
    senderName: "tester",
    policyDecision: "allowed",
    reasonCodes: [],
    runtimeCheck: { ok: true },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  const runtime = __activeTasks.get("user-ws-fallback");
  assert.ok(runtime);
  assert.equal(runtime.task.status, "running");
  assert.match(replies.join("\n"), /任务已启动|Codex task started/);
  await cleanupActiveTaskRuntimes(__activeTasks);
});

test("runtime/execution_backend/fallback: ws start failure fails closed when fallback is disabled", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-ws-fallback-disabled-"));
  const { bridge, replies } = await createBridgeHarness(tempRoot, {
    pluginConfig: {
      codexBin: "/bin/true",
      executionBackend: "ws",
      wsBackendUrl: "http://127.0.0.1:18766",
      wsBackendAutoFallbackToCli: false,
      heartbeatMs: 60_000,
    },
  });

  bridge.ensureExecutionRuntimeReady = async () => ({ ok: true });

  await bridge.startTask({
    profile: {
      senderId: "user-ws-no-fallback",
      accountId: "default",
      conversationId: "conv-ws-no-fallback",
      defaultCwd: tempRoot,
      updatedAt: "2026-04-17T00:00:00.000Z",
    },
    accountId: "default",
    conversationId: "conv-ws-no-fallback",
    messageId: "msg-ws-no-fallback",
    mode: "new",
    prompt: "test ws no fallback",
    cwd: tempRoot,
    senderName: "tester",
    policyDecision: "allowed",
    reasonCodes: [],
    runtimeCheck: { ok: true },
  });

  assert.equal(bridge.getActiveTask("user-ws-no-fallback"), null);
  assert.match(replies.join("\n"), /invalid ws backend url|任务失败|task failed/i);
});
