import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexArgs, buildCodexEnv } from "../lib/codex-exec.js";

test("runtime/env/allowlist: buildCodexEnv only forwards allowlisted variables", () => {
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

test("runtime/env/isolation: buildCodexEnv keeps HOME isolated even with an explicit allowlist", () => {
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

test("runtime/exec/resume: resume mode still carries explicit cwd semantics in prompt metadata", () => {
  const args = buildCodexArgs({
    task: { mode: "resume", cwd: "/repo/worktree", prompt: "continue", sessionId: "1234" },
    settings: { locale: "en-US" },
  });

  assert.equal(args.includes("-C"), false);
  assert.equal(args.at(-1).includes("Feishu remote Codex bridge task."), true);
  assert.equal(args.at(-1).includes("Feishu remote Codex Runner task."), false);
  assert.equal(args.at(-1).includes("Working directory: /repo/worktree"), true);
  assert.equal(
    args.at(-1).includes("Resume cwd semantics: use the working directory above for any new commands in this resumed run."),
    true,
  );
});

test("runtime/exec/options: native model and execution flags map to codex exec args", () => {
  const args = buildCodexArgs({
    task: {
      mode: "new",
      cwd: "/repo/worktree",
      prompt: "summarize README.md",
      executionOptions: {
        model: "gpt-5.3-codex",
        sandbox: "workspace-write",
        askForApproval: "on-request",
      },
    },
    settings: { locale: "en-US" },
  });

  assert.equal(args.includes("--full-auto"), false);
  assert.deepEqual(args.slice(0, 9), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-m",
    "gpt-5.3-codex",
    "-s",
    "workspace-write",
    "-a",
    "on-request",
  ]);
  assert.equal(args.includes("-C"), true);
});
