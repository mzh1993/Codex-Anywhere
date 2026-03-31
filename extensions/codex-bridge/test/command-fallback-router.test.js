import test from "node:test";
import assert from "node:assert/strict";

test("constitution/command_fallback/doctor: doctor is handled before unknown fallbacks", async () => {
  const { handleCommandFallback } = await import("../lib/command-fallback-router.js");

  const calls = [];
  const bridge = {
    async formatDoctor() {
      calls.push("doctor");
      return "health";
    },
    async safeReply(params) {
      calls.push(["reply", params.text]);
    },
    async sendUnknownCommand() {
      calls.push("unknown");
    },
  };

  const handled = await handleCommandFallback({
    bridge,
    profile: { senderId: "user-1" },
    request: {
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-1",
    },
    parsed: { name: "doctor", args: "" },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["doctor", ["reply", "health"]]);
});

test("constitution/command_fallback/help: help falls back to the same short help as bare /codex", async () => {
  const { handleCommandFallback } = await import("../lib/command-fallback-router.js");

  const calls = [];
  const bridge = {
    async formatDoctor() {
      throw new Error("should not be called");
    },
    async sendHelp() {
      calls.push("help");
    },
    async safeReply() {
      throw new Error("should not be called");
    },
    async sendUnknownCommand() {
      throw new Error("should not be called");
    },
  };

  const handled = await handleCommandFallback({
    bridge,
    profile: { senderId: "user-1" },
    request: {
      accountId: "default",
      conversationId: "conv-1",
      messageId: "msg-1",
    },
    parsed: { name: "help", args: "" },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["help"]);
});

test("constitution/command_fallback/unknown: legacy and unknown subcommands other than help fall through to unknown", async () => {
  const { handleCommandFallback } = await import("../lib/command-fallback-router.js");

  for (const name of ["status", "abort", "approve", "new"]) {
    const calls = [];
    const bridge = {
      async formatDoctor() {
        throw new Error("should not be called");
      },
      async sendHelp() {
        throw new Error("should not be called");
      },
      async safeReply() {
        throw new Error("should not be called");
      },
      async sendUnknownCommand(_request, commandName) {
        calls.push(commandName);
      },
    };

    const handled = await handleCommandFallback({
      bridge,
      profile: { senderId: "user-1" },
      request: {
        accountId: "default",
        conversationId: "conv-1",
        messageId: "msg-1",
      },
      parsed: { name, args: "TOKEN1" },
    });

    assert.equal(handled, true);
    assert.deepEqual(calls, [name]);
  }
});
