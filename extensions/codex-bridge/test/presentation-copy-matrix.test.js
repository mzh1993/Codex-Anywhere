import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getLocaleText } from "../lib/locale.js";

function assertOrderedCopy(text, { primary, fallback, forbidden = [] }) {
  const primaryIndex = text.indexOf(primary);
  const fallbackIndex = text.indexOf(fallback);
  assert.notEqual(primaryIndex, -1, `missing primary copy: ${primary}`);
  assert.notEqual(fallbackIndex, -1, `missing fallback copy: ${fallback}`);
  assert.ok(primaryIndex < fallbackIndex, `expected primary copy before fallback copy.\n${text}`);
  for (const snippet of forbidden) {
    assert.equal(text.includes(snippet), false, `unexpected copy present: ${snippet}\n${text}`);
  }
}

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

async function createBridgeHarness(pluginConfig = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-presentation-copy-"));
  const { CodexBridge } = await import("../index.js");
  const bridge = new CodexBridge(createFakeApi(tempRoot, pluginConfig));
  bridge.ensureCodexHome = async () => {};
  bridge.snapshotSessionFiles = async () => new Set();
  return bridge;
}

test("presentation/copy/help_matrix: help and unknown command teach direct reply before explicit resume", () => {
  const cases = [
    {
      locale: "zh-CN",
      primary: "继续当前工作：直接回复下一步给 Codex。",
      fallback: "如需显式续写，再用 `/codex resume 继续`。",
    },
    {
      locale: "en-US",
      primary: "To continue current work, reply directly with the next step for Codex.",
      fallback: "If you need an explicit resume fallback: `/codex resume continue`",
    },
  ];

  for (const entry of cases) {
    const text = getLocaleText(entry.locale);
    for (const surface of [text.help("."), text.unknownCommand("/codex nope", ".")]) {
      assertOrderedCopy(surface, {
        primary: entry.primary,
        fallback: entry.fallback,
      });
    }
  }
});

test("presentation/copy/active_task_matrix: awaiting-input guidance teaches direct reply before fallback resume", () => {
  const cases = [
    {
      locale: "zh-CN",
      primary: "当前任务正在等待你的下一条输入，直接回复下一步给 Codex。",
      fallback: "如需兜底，也可以使用 `/codex resume 继续`。",
      forbidden: ["请先使用 `/codex resume 继续` 处理当前任务。"],
    },
    {
      locale: "en-US",
      primary: "This task is waiting for your next message. Reply directly with the next step for Codex.",
      fallback: "If needed, you can also use `/codex resume continue` as a fallback.",
      forbidden: ["Use `/codex resume continue` to handle the current task first."],
    },
  ];

  for (const entry of cases) {
    const text = getLocaleText(entry.locale).taskAlreadyRunning({
      taskId: "task-1",
      status: "awaiting_input",
      code: "active_task_exists",
    });
    assertOrderedCopy(text, entry);
  }
});

test("presentation/copy/interruption_matrix: interruption guidance keeps direct reply as the primary path", () => {
  const cases = [
    {
      locale: "zh-CN",
      primary: "请直接回复下一步给 Codex",
      fallback: "如需兜底，也可以使用 `/codex resume 继续`。",
      forbidden: ["请使用 `/codex resume 继续`"],
    },
    {
      locale: "en-US",
      primary: "Reply directly with the next step for Codex.",
      fallback: "If needed, you can also use `/codex resume continue`.",
      forbidden: ["Use `/codex resume continue`"],
    },
  ];

  for (const entry of cases) {
    const text = getLocaleText(entry.locale).interruptedTaskRequiresContinue("task-1");
    assertOrderedCopy(text, entry);
  }
});

test("presentation/copy/finish_matrix: awaiting-input finish copy stays run-scoped rather than task-ended", () => {
  const cases = [
    {
      locale: "zh-CN",
      runStatus: "completed",
      expected: "本轮执行已完成：task-1",
      forbidden: ["Codex 任务已完成：task-1", "Codex 任务已终止：task-1"],
    },
    {
      locale: "zh-CN",
      runStatus: "failed",
      expected: "本轮执行失败：task-1",
      forbidden: ["Codex 任务失败：task-1", "Codex 任务已终止：task-1"],
    },
    {
      locale: "en-US",
      runStatus: "completed",
      expected: "Codex run completed: task-1",
      forbidden: ["Codex task completed: task-1", "Codex task aborted: task-1"],
    },
    {
      locale: "en-US",
      runStatus: "failed",
      expected: "Codex run failed: task-1",
      forbidden: ["Codex task failed: task-1", "Codex task aborted: task-1"],
    },
  ];

  for (const entry of cases) {
    const text = getLocaleText(entry.locale).taskFinished({
      taskId: "task-1",
      cwd: "/repo",
      status: "awaiting_input",
      runStatus: entry.runStatus,
      nextSteps: [],
      summary: "",
      error: null,
    });
    assert.match(text, new RegExp(entry.expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, entry.locale === "zh-CN" ? /状态：等待输入/ : /status: awaiting_input/);
    for (const snippet of entry.forbidden) {
      assert.equal(text.includes(snippet), false, `unexpected copy present: ${snippet}\n${text}`);
    }
  }
});

test("presentation/card/finish_matrix: finished run cards keep continuity-friendly run result metadata", async () => {
  const cases = [
    { locale: "zh-CN", expectedTitle: "本轮结果" },
    { locale: "en-US", expectedTitle: "Run Result" },
  ];

  for (const entry of cases) {
    const bridge = await createBridgeHarness({ locale: entry.locale });
    const prepared = bridge.prepareReply({
      text: "summary",
      renderHint: "task_finished",
    });
    assert.equal(prepared.text, undefined);
    assert.equal(prepared.card?.header?.title?.content, entry.expectedTitle);
  }
});
