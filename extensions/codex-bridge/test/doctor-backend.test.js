import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
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

async function createBridgeHarness(tempRoot, pluginConfig = {}) {
  const { CodexBridge } = await import("../index.js");
  const bridge = new CodexBridge(createFakeApi(tempRoot, pluginConfig));
  bridge.ensureExecutionRuntimeReady = async () => ({
    ok: true,
    codexVersion: "codex-cli 0.121.0",
    bwrapVersion: "0.11.0",
  });
  bridge.probeGatewayHealthForDoctor = async () => "正常";
  bridge.probeFeishuRuntimeForDoctor = async () => ({ ok: true, label: "已就绪" });
  return bridge;
}

test("runtime/doctor/backend: doctor shows cli backend and ws disabled by default", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-backend-cli-"));
  const bridge = await createBridgeHarness(tempRoot);

  const text = await bridge.formatDoctor("sender-1", null);

  assert.match(text, /执行后端：cli/);
  assert.match(text, /WS 后端：未启用/);
});

test("runtime/doctor/backend: doctor shows ws backend unreachable when loopback endpoint is down", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-backend-ws-down-"));
  const bridge = await createBridgeHarness(tempRoot, {
    executionBackend: "ws",
    wsBackendUrl: "ws://127.0.0.1:18799",
  });

  const text = await bridge.formatDoctor("sender-2", null);

  assert.match(text, /执行后端：ws/);
  assert.match(text, /WS 后端：不可达/);
});

test("runtime/doctor/backend: doctor shows ws backend reachable when loopback endpoint is up", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-doctor-backend-ws-up-"));
  const server = net.createServer(() => {});
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const bridge = await createBridgeHarness(tempRoot, {
      executionBackend: "ws",
      wsBackendUrl: `ws://127.0.0.1:${port}`,
    });

    const text = await bridge.formatDoctor("sender-3", null);

    assert.match(text, /执行后端：ws/);
    assert.match(text, /WS 后端：已连通/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
