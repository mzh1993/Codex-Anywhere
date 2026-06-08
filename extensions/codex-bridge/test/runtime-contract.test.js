import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function createLinuxInstallReplayHarness(t, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-feishu-install-"));
  const scriptsDir = path.join(tempRoot, "scripts");
  const binDir = path.join(tempRoot, "bin");
  const installScriptPath = path.join(scriptsDir, "install.sh");
  const bootstrapLogPath = path.join(tempRoot, "bootstrap.log");
  const healthPath = path.join(tempRoot, ".isolated", "codex-feishu", "state", "install-health.json");

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "scripts", "install.sh"), installScriptPath);
  fs.chmodSync(installScriptPath, 0o755);

  writeExecutable(
    path.join(scriptsDir, "bootstrap-codex-feishu.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$1" >> ${JSON.stringify(bootstrapLogPath)}
case "$1" in
  gateway-status)
    printf '%s\\n' "\${MOCK_GATEWAY_STATUS_OUTPUT:-Port check:      not listening on 19789}"
    ;;
esac
`,
  );

  for (const commandName of ["node", "npm", "codex"]) {
    writeExecutable(
      path.join(binDir, commandName),
      `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
    );
  }

  if (options.withSystemctl) {
    writeExecutable(
      path.join(binDir, "systemctl"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "--user" && "$2" == "is-active" && "$3" == "--quiet" ]]; then
  if [[ "\${MOCK_SYSTEMCTL_ACTIVE:-yes}" == "yes" ]]; then
    exit 0
  fi
  exit 1
fi
exit 0
`,
    );
  }

  return {
    tempRoot,
    installScriptPath,
    bootstrapLogPath,
    healthPath,
    binDir,
  };
}

function runLinuxInstallReplay(harness, args = [], env = {}) {
  return spawnSync("bash", [harness.installScriptPath, ...args], {
    cwd: harness.tempRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH}`,
      CODEX_FEISHU_APP_ID: "cli_test_app",
      CODEX_FEISHU_APP_SECRET: "secret_test_value",
      ...env,
    },
  });
}

test("runtime/contract/schema: plugin schema accepts envAllowlist", () => {
  const pluginManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "extensions", "codex-bridge", "openclaw.plugin.json"), "utf8"),
  );

  assert.equal(pluginManifest.configSchema.additionalProperties, false);
  assert.deepEqual(pluginManifest.configSchema.properties.envAllowlist, {
    type: "array",
    items: {
      type: "string",
    },
  });
  assert.deepEqual(pluginManifest.configSchema.properties.groupAllowlistConversationIds, {
    type: "array",
    items: {
      type: "string",
    },
  });
  assert.deepEqual(pluginManifest.configSchema.properties.bridgeServiceUnitNames, {
    type: "array",
    items: {
      type: "string",
    },
  });
  assert.deepEqual(pluginManifest.configSchema.properties.runtimeMode, {
    type: "string",
    enum: ["secure_linux", "native_windows_fast"],
  });
  assert.deepEqual(pluginManifest.configSchema.properties.executionBackend, {
    type: "string",
    enum: ["cli", "ws"],
  });
  assert.deepEqual(pluginManifest.configSchema.properties.wsBackendUrl, {
    type: "string",
  });
  assert.deepEqual(pluginManifest.configSchema.properties.wsBackendAuthTokenEnv, {
    type: "string",
  });
  assert.deepEqual(pluginManifest.configSchema.properties.wsBackendAutoFallbackToCli, {
    type: "boolean",
  });
});

test("runtime/contract/systemd: generated systemd unit uses an always-restart policy", () => {
  const bootstrapScript = fs.readFileSync(path.join(repoRoot, "scripts", "bootstrap-codex-feishu.sh"), "utf8");

  assert.match(bootstrapScript, /Restart=always/);
});

test("runtime/contract/preflight: bootstrap preflight probes the real codex sandbox runtime", () => {
  const bootstrapScript = fs.readFileSync(path.join(repoRoot, "scripts", "bootstrap-codex-feishu.sh"), "utf8");

  assert.match(bootstrapScript, /require_command codex/);
  assert.match(bootstrapScript, /HOST_BWRAP_BIN="\/usr\/bin\/bwrap"/);
  assert.match(bootstrapScript, /MIN_BWRAP_VERSION="0\.9\.0"/);
  assert.match(bootstrapScript, /codex sandbox -- \/bin\/true/);
  assert.match(bootstrapScript, /codex sandbox linux -- \/bin\/true/);
  assert.match(bootstrapScript, /must be >= \$\{MIN_BWRAP_VERSION\}/);
});

test("runtime/contract/deployment: bootstrap default host paths derive from the current user home instead of author-specific paths", () => {
  const bootstrapScript = fs.readFileSync(path.join(repoRoot, "scripts", "bootstrap-codex-feishu.sh"), "utf8");

  assert.doesNotMatch(bootstrapScript, /\/home\/neousys/);
  assert.match(bootstrapScript, /DEFAULT_CWD_DEFAULT="\$\{HOME\}"/);
  assert.match(bootstrapScript, /AUTH_JSON_PATH_DEFAULT="\$\{HOME\}\/\.codex\/auth\.json"/);
  assert.match(bootstrapScript, /CONFIG_TOML_PATH_DEFAULT="\$\{HOME\}\/\.codex\/config\.toml"/);
});

test("runtime/contract/deployment: windows launcher respects the installer BasePort instead of hardcoding 19789", () => {
  const installScript = fs.readFileSync(path.join(repoRoot, "scripts", "install.ps1"), "utf8");

  assert.doesNotMatch(installScript, /set OPENCLAW_GATEWAY_PORT=19789/);
  assert.match(installScript, /\[int\]\$BasePort = 19789/);
  assert.match(installScript, /\[int\]\$BasePortValue/);
  assert.match(installScript, /set OPENCLAW_GATEWAY_PORT=\$basePortEscaped/);
  assert.match(installScript, /Write-GatewayLauncherCmd[\s\S]*-BasePortValue \$BasePort/);
});

test("runtime/contract/deployment: identify helper stays on the current /codex command surface and avoids app-specific fingerprints", () => {
  const identifyScript = fs.readFileSync(path.join(repoRoot, "scripts", "send-feishu-identify.sh"), "utf8");

  assert.doesNotMatch(identifyScript, /\/acp doctor/);
  assert.doesNotMatch(identifyScript, /AppID 后四位/);
  assert.match(identifyScript, /\/codex doctor/);
});

test("runtime/contract/review: experience regression runner includes the runtime-contract deployment suite", () => {
  const reviewScript = fs.readFileSync(path.join(repoRoot, "scripts", "review", "run-experience-regression.sh"), "utf8");
  const checklist = fs.readFileSync(path.join(repoRoot, "docs", "experience-regression-checklist.md"), "utf8");

  assert.match(reviewScript, /runtime-contract/);
  assert.match(reviewScript, /extensions\/codex-bridge\/test\/runtime-contract\.test\.js/);
  assert.match(checklist, /Deployment|部署/);
});

test("runtime/contract/review: contract matrix guard includes dirty worktree files instead of only committed git ranges", () => {
  const guardScript = fs.readFileSync(path.join(repoRoot, "scripts", "review", "check-contract-matrix.sh"), "utf8");

  assert.match(guardScript, /git diff --name-only "\$\{RANGE\}"/);
  assert.match(guardScript, /git diff --cached --name-only/);
  assert.match(guardScript, /git diff --name-only \|\| true/);
  assert.match(guardScript, /git ls-files --others --exclude-standard/);
  assert.match(guardScript, /scripts\/bootstrap-codex-feishu\.sh/);
  assert.match(guardScript, /scripts\/install\.sh/);
  assert.match(guardScript, /scripts\/install\.ps1/);
  assert.match(guardScript, /scripts\/send-feishu-identify\.sh/);
});

test("runtime/contract/docs: README documents the minimum execution infrastructure", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  assert.match(readme, /\/usr\/bin\/bwrap >= 0\.9\.0/);
  assert.match(readme, /codex-cli 0\.120\.0/);
  assert.match(readme, /\/usr\/bin\/bwrap/);
  assert.match(readme, /任务启动前直接拒绝/);
});

test("runtime/contract/docs: README and V1 docs present direct reply as the default continuation path", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const v1Doc = fs.readFileSync(path.join(repoRoot, "docs", "feishu-codex-bridge-v1.md"), "utf8");
  const contractMatrix = fs.readFileSync(path.join(repoRoot, "docs", "contract-matrix.md"), "utf8");

  assert.match(readme, /继续当前工作：直接回复下一步给 Codex/);
  assert.match(readme, /如需显式续写，再用 `\/codex resume <prompt>`/);
  assert.match(v1Doc, /普通文本仍是默认续写路径/);
  assert.match(v1Doc, /如需显式续写.*`\/codex resume/);
  assert.match(v1Doc, /run 完成或失败后，task 默认回到 `awaiting_input`/);
  assert.match(contractMatrix, /CS-002/);
});

test("runtime/contract/docs: deployment docs and contract matrix describe hosting-aware linux install health", () => {
  const deploymentDoc = fs.readFileSync(path.join(repoRoot, "docs", "deployment-p1-cross-platform.md"), "utf8");
  const contractMatrix = fs.readFileSync(path.join(repoRoot, "docs", "contract-matrix.md"), "utf8");

  assert.match(deploymentDoc, /serviceActive` is recorded as `skipped`/);
  assert.match(deploymentDoc, /message=foreground_manual_start_required/);
  assert.match(contractMatrix, /XP-008/);
  assert.match(contractMatrix, /foreground manual-start truth instead of ambiguous service-state placeholders/);
});

test("runtime/contract/deployment: linux installer replay keeps the bootstrap call order and records systemd hosting health", (t) => {
  const harness = createLinuxInstallReplayHarness(t, { withSystemctl: true });

  const result = runLinuxInstallReplay(harness, [], {
    MOCK_GATEWAY_STATUS_OUTPUT: "Port check:      listening on 19789",
    MOCK_SYSTEMCTL_ACTIVE: "yes",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(harness.bootstrapLogPath, "utf8").trim().split("\n"), [
    "bootstrap",
    "persist-secrets",
    "preflight",
    "install-systemd",
    "gateway-status",
  ]);

  const health = JSON.parse(fs.readFileSync(harness.healthPath, "utf8"));
  assert.equal(health.result, "ok");
  assert.equal(health.message, "install_completed");
  assert.equal(health.hostingMode, "systemd");
  assert.equal(health.serviceActive, "yes");
  assert.equal(health.gatewayListening, "yes");
  assert.equal(health.basePort, 19789);
  assert.match(result.stdout, /next \(Feishu\): \/codex doctor/);
});

test("runtime/contract/deployment: linux installer no-systemd replay records foreground hosting instead of ambiguous service state", (t) => {
  const harness = createLinuxInstallReplayHarness(t);

  const result = runLinuxInstallReplay(harness, ["--no-systemd"], {
    MOCK_GATEWAY_STATUS_OUTPUT: "Port check:      not listening on 19789",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(harness.bootstrapLogPath, "utf8").trim().split("\n"), [
    "bootstrap",
    "persist-secrets",
    "preflight",
    "gateway-status",
  ]);

  const health = JSON.parse(fs.readFileSync(harness.healthPath, "utf8"));
  assert.equal(health.result, "warn");
  assert.equal(health.message, "foreground_manual_start_required");
  assert.equal(health.hostingMode, "foreground");
  assert.equal(health.serviceActive, "skipped");
  assert.equal(health.gatewayListening, "no");
  assert.match(result.stdout, /systemd install disabled/);
  assert.match(result.stdout, /run foreground: .*gateway-run --base-port 19789 --runtime-mode secure_linux/);
});
