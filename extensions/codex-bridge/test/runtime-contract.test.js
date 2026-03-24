import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

test("plugin schema accepts envAllowlist", () => {
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
});

test("generated systemd unit uses an always-restart policy", () => {
  const bootstrapScript = fs.readFileSync(path.join(repoRoot, "scripts", "bootstrap-codex-feishu.sh"), "utf8");

  assert.match(bootstrapScript, /Restart=always/);
});
