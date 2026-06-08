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
        reasoningEffort: "high",
      },
    },
    settings: { locale: "en-US" },
  });

  assert.equal(args.includes("--full-auto"), true);
  assert.deepEqual(args.slice(0, 8), [
    "exec",
    "--full-auto",
    "--json",
    "--skip-git-repo-check",
    "-m",
    "gpt-5.3-codex",
    "-c",
    'model_reasoning_effort="high"',
  ]);
  assert.equal(args.includes("-C"), true);
});

test("runtime/exec/windows_fast: native_windows_fast defaults to bypass sandbox for stable execution", () => {
  const args = buildCodexArgs({
    task: {
      mode: "new",
      cwd: "C:/repo/worktree",
      prompt: "summarize README.md",
      executionOptions: {
        askForApproval: "never",
      },
    },
    settings: { locale: "en-US", runtimeMode: "native_windows_fast" },
  });

  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), true);
  assert.equal(args.includes("--full-auto"), false);
  assert.equal(args.includes("-a"), false);
});

test("runtime/exec/prompt_metadata: prompt includes effective model, reasoning, and cwd metadata for self-reporting", () => {
  const args = buildCodexArgs({
    task: {
      mode: "resume",
      cwd: "/home/mzh",
      prompt: "你现在使用的是什么模型？思考等级是多少？工作目录在哪里？",
      sessionId: "session-1",
      executionOptions: {
        model: "gpt-5.2",
        reasoningEffort: "high",
      },
    },
    settings: { locale: "zh-CN" },
  });

  const prompt = args.at(-1);
  assert.equal(prompt.includes("Execution model: gpt-5.2"), true);
  assert.equal(prompt.includes("Execution reasoning effort: high"), true);
  assert.equal(prompt.includes("Working directory: /home/mzh"), true);
  assert.equal(prompt.includes("If asked about the current model, reasoning effort, or working directory, answer from the execution metadata above."), true);
});

test("runtime/exec/reply_plane: prompt requires a delivery manifest without target-address semantics", () => {
  const args = buildCodexArgs({
    task: {
      mode: "new",
      cwd: "/repo/worktree",
      prompt: "整理报告并把最终产物带回来",
    },
    settings: { locale: "zh-CN" },
  });

  const prompt = args.at(-1);
  assert.equal(prompt.includes("Delivery Manifest"), true);
  assert.equal(
    prompt.includes("At the end of the final answer, include a section named `Delivery Manifest` with a JSON code block."),
    true,
  );
  assert.equal(prompt.includes("Do not include target addresses or delivery-routing fields."), true);
  assert.equal(
    prompt.includes("For `file`, `image`, `audio`, and `video`, only declare paths relative to the working directory."),
    true,
  );
  assert.equal(
    prompt.includes("For generated HTML pages or web previews, declare the deliverable as `kind: \"file\"`, not `kind: \"html\"`."),
    true,
  );
  assert.equal(
    prompt.includes("When the user explicitly asks for one primary output, declare only that primary deliverable by default."),
    true,
  );
  assert.equal(
    prompt.includes("Keep supporting notes or companion docs in `summary` unless the user explicitly asks for them to be returned too."),
    true,
  );
  assert.equal(
    prompt.includes("Do not declare supporting artifacts just because they were created during the task."),
    true,
  );
});
