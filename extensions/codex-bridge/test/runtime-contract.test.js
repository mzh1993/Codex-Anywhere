import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

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
  assert.match(bootstrapScript, /codex sandbox linux -- \/bin\/true/);
  assert.match(bootstrapScript, /must be >= \$\{MIN_BWRAP_VERSION\}/);
});

test("runtime/contract/docs: README documents the minimum execution infrastructure", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  assert.match(readme, /\/usr\/bin\/bwrap >= 0\.9\.0/);
  assert.match(readme, /codex-cli 0\.116\.0/);
  assert.match(readme, /\/usr\/bin\/bwrap/);
  assert.match(readme, /任务启动前直接拒绝/);
});
