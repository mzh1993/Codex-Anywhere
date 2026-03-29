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

test("constitution/compat_layer/fallback: compat router declines unknown slash commands", async () => {
  const { handleCompatCodexCommand } = await import("../lib/compat-command-router.js");

  const handled = await handleCompatCodexCommand({
    bridge: {},
    parsed: { name: "new", args: "" },
    request: {},
    profile: {},
    routeAbortCommand() {
      throw new Error("should not be called");
    },
    routeApproveCommand() {
      throw new Error("should not be called");
    },
  });

  assert.equal(handled, false);
});
