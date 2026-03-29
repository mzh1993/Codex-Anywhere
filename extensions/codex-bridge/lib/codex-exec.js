import { DEFAULT_ENV_ALLOWLIST } from "./settings.js";

const DEFAULT_LOCALE = "en-US";

export function buildCodexEnv({ codexHome, inheritedEnv = process.env, envAllowlist = DEFAULT_ENV_ALLOWLIST }) {
  const env = Object.fromEntries(
    normalizeEnvAllowlist(envAllowlist)
      .filter((key) => inheritedEnv[key] !== undefined)
      .map((key) => [key, inheritedEnv[key]]),
  );
  env.HOME = codexHome;
  env.CODEX_HOME = codexHome;
  return env;
}

export function buildCodexArgs({ task, settings, outputPath = null }) {
  const args = ["exec"];
  if (task.mode === "resume") args.push("resume");
  args.push(...buildSharedArgs(task, outputPath));
  if (task.mode !== "resume") {
    args.push("-C", task.cwd);
  } else if (task.sessionId) {
    args.push(task.sessionId);
  }
  args.push(buildBridgeTaskPrompt({ task, settings }));
  return args;
}

export function buildBridgeTaskPrompt({ task, settings = {} }) {
  const policyLines = [
    "You are running inside a Feishu remote Codex bridge task.",
    `Working directory: ${task.cwd}`,
    `Task mode: ${task.mode}`,
    task.mode === "resume"
      ? "Resume cwd semantics: use the working directory above for any new commands in this resumed run."
      : "Start the run in the working directory above.",
    "Treat this as a bounded execution task, not a persona chat.",
    "Return a concise final answer with: summary, changed files, and next steps.",
    getResponseLanguageInstruction(task.locale ?? settings.locale),
  ];
  if (task.riskLevel === "high") {
    policyLines.push("High-risk approval has already been granted for this run.");
  } else {
    policyLines.push("Do not modify ~/.codex, ~/.openclaw, systemd units, shell startup files, or global package environments.");
  }
  policyLines.push("");
  policyLines.push("User task:");
  policyLines.push(task.prompt);
  return policyLines.join("\n");
}

function buildSharedArgs(task, outputPath) {
  const args = [];
  if (task.riskLevel === "high") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (!task.executionOptions?.sandbox && !task.executionOptions?.askForApproval) {
    args.push("--full-auto");
  }
  args.push("--json", "--skip-git-repo-check");
  if (task.executionOptions?.model) {
    args.push("-m", task.executionOptions.model);
  }
  if (task.executionOptions?.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${task.executionOptions.reasoningEffort}"`);
  }
  if (task.riskLevel !== "high" && task.executionOptions?.sandbox) {
    args.push("-s", task.executionOptions.sandbox);
  }
  if (task.riskLevel !== "high" && task.executionOptions?.askForApproval) {
    args.push("-a", task.executionOptions.askForApproval);
  }
  if (outputPath) {
    args.push("-o", outputPath);
  }
  return args;
}

function getResponseLanguageInstruction(locale) {
  return normalizeLocale(locale) === "zh-CN" ? "Respond in Simplified Chinese." : "Respond in English.";
}

function normalizeEnvAllowlist(value) {
  if (!Array.isArray(value)) return DEFAULT_ENV_ALLOWLIST;
  const allowlist = Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    ),
  );
  return allowlist.length > 0 ? allowlist : DEFAULT_ENV_ALLOWLIST;
}

function normalizeLocale(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return DEFAULT_LOCALE;
  if (/^zh(?:[-_].*)?$/i.test(normalized)) return "zh-CN";
  return "en-US";
}
