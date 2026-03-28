import test from "node:test";
import assert from "node:assert/strict";

test("constitution/compat_layer/surface: compat layer only claims legacy slash commands", async () => {
  const { isCompatCodexCommand } = await import("../lib/compat-command-router.js");

  assert.equal(isCompatCodexCommand("help"), true);
  assert.equal(isCompatCodexCommand("status"), true);
  assert.equal(isCompatCodexCommand("abort"), true);
  assert.equal(isCompatCodexCommand("approve"), true);

  assert.equal(isCompatCodexCommand("doctor"), false);
  assert.equal(isCompatCodexCommand("resume"), false);
  assert.equal(isCompatCodexCommand("pwd"), false);
  assert.equal(isCompatCodexCommand("cwd"), false);
  assert.equal(isCompatCodexCommand("continue"), false);
  assert.equal(isCompatCodexCommand("new"), false);
  assert.equal(isCompatCodexCommand("foo"), false);
  assert.equal(isCompatCodexCommand(""), false);
});
