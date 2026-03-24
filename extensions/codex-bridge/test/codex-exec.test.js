import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexArgs, buildCodexEnv } from "../lib/codex-exec.js";

test("buildCodexEnv only forwards allowlisted variables", () => {
  const env = buildCodexEnv({
    codexHome: "/tmp/codex-home",
    inheritedEnv: {
      PATH: "/usr/bin",
      HOME: "/home/neousys",
      CODEX_FEISHU_APP_SECRET: "secret",
      OPENAI_API_KEY: "secret",
    },
  });

  assert.equal(env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/tmp/codex-home");
  assert.equal("CODEX_FEISHU_APP_SECRET" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
});

test("buildCodexEnv keeps HOME isolated even with an explicit allowlist", () => {
  const env = buildCodexEnv({
    codexHome: "/tmp/codex-home",
    inheritedEnv: {
      PATH: "/usr/bin",
      HOME: "/home/neousys",
      CUSTOM_FLAG: "enabled",
      LANG: "en_US.UTF-8",
    },
    envAllowlist: ["PATH", "CUSTOM_FLAG"],
  });

  assert.deepEqual(env, {
    PATH: "/usr/bin",
    CUSTOM_FLAG: "enabled",
    HOME: "/tmp/codex-home",
    CODEX_HOME: "/tmp/codex-home",
  });
});

test("resume mode still carries explicit cwd semantics in prompt metadata", () => {
  const args = buildCodexArgs({
    task: { mode: "resume", cwd: "/repo/worktree", prompt: "continue", sessionId: "1234" },
    settings: { locale: "en-US" },
  });

  assert.equal(args.includes("-C"), false);
  assert.equal(args.at(-1).includes("Working directory: /repo/worktree"), true);
  assert.equal(
    args.at(-1).includes("Resume cwd semantics: use the working directory above for any new commands in this resumed run."),
    true,
  );
});
