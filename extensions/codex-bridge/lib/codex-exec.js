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
  args.push(...buildSharedArgs(task, settings, outputPath));
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
    `Execution model: ${task.executionOptions?.model ?? "default"}`,
    `Execution reasoning effort: ${task.executionOptions?.reasoningEffort ?? "default"}`,
    task.mode === "resume"
      ? "Resume cwd semantics: use the working directory above for any new commands in this resumed run."
      : "Start the run in the working directory above.",
    "If asked about the current model, reasoning effort, or working directory, answer from the execution metadata above.",
    "Treat this as a bounded execution task, not a persona chat.",
    "Return a concise final answer with: summary, changed files, and next steps.",
    "At the end of the final answer, include a section named `Delivery Manifest` with a JSON code block.",
    "The `Delivery Manifest` JSON must contain `summary` and may contain `deliverables` plus optional `note`.",
    "Do not include target addresses or delivery-routing fields.",
    "Only declare final user-consumable outputs that should come back to the current Feishu origin.",
    "When the user explicitly asks for one primary output, declare only that primary deliverable by default.",
    "Keep supporting notes or companion docs in `summary` unless the user explicitly asks for them to be returned too.",
    "Do not declare supporting artifacts just because they were created during the task.",
    "For `file`, `image`, `audio`, and `video`, each deliverable must use a `path` field (not `file`) with a path relative to the working directory.",
    "For generated HTML pages or web previews, declare the deliverable as `kind: \"file\"`, not `kind: \"html\"`.",
    "Do not declare absolute paths, `..` paths, temporary files, scratch outputs, or undeclared guesses.",
    "For `link`, use a `url` field.",
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

function buildSharedArgs(task, settings, outputPath) {
  const args = [];
  const useNativeWindowsBypass = shouldUseNativeWindowsBypass(task, settings);
  if (task.riskLevel === "high") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (useNativeWindowsBypass) {
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
  if (task.riskLevel !== "high" && !useNativeWindowsBypass && task.executionOptions?.sandbox) {
    args.push("-s", task.executionOptions.sandbox);
  }
  if (task.riskLevel !== "high" && !useNativeWindowsBypass && task.executionOptions?.askForApproval) {
    args.push("-a", task.executionOptions.askForApproval);
  }
  if (outputPath) {
    args.push("-o", outputPath);
  }
  return args;
}

function shouldUseNativeWindowsBypass(task, settings) {
  if (settings?.runtimeMode !== "native_windows_fast") return false;
  if (task.riskLevel === "high") return false;
  // Windows quick mode defaults to a no-sandbox path to avoid helper/UAC launch failures.
  return !task.executionOptions?.sandbox;
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
