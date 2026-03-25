import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { ensureIsolatedOpenClawShim } from "../lib/openclaw-shim.js";

test("runtime/env/openclaw: ensureIsolatedOpenClawShim writes wrapper-compatible shim under isolated HOME", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-bridge-openclaw-shim-"));
  const codexHome = path.join(root, "codex-home");
  const isolatedCliPath = "/repo/scripts/openclaw-isolated.sh";

  const shimPath = await ensureIsolatedOpenClawShim({ codexHome, isolatedCliPath });
  const script = await fsp.readFile(shimPath, "utf8");
  const stat = await fsp.stat(shimPath);

  assert.equal(shimPath, path.join(codexHome, ".npm-global", "bin", "openclaw"));
  assert.match(script, /unset OPENCLAW_GATEWAY_URL/);
  assert.match(script, /unset OPENCLAW_GATEWAY_TOKEN/);
  assert.match(script, /exec '\/repo\/scripts\/openclaw-isolated\.sh' "\$@"/);
  assert.ok((stat.mode & 0o111) !== 0);
});
