import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  attachExecutionBackendHandlers,
  resolveExecutionBackend,
  startExecutionBackendRun,
} from "../lib/execution-backend.js";

test("runtime/execution_backend/resolve: defaults to cli and accepts ws when explicitly configured", () => {
  assert.equal(resolveExecutionBackend({}), "cli");
  assert.equal(resolveExecutionBackend({ executionBackend: "" }), "cli");
  assert.equal(resolveExecutionBackend({ executionBackend: "unknown" }), "cli");
  assert.equal(resolveExecutionBackend({ executionBackend: "CLI" }), "cli");
  assert.equal(resolveExecutionBackend({ executionBackend: "ws" }), "ws");
});

test("runtime/execution_backend/start: cli backend delegates to spawn with unchanged process options", () => {
  const fakeChild = new EventEmitter();
  const calls = [];
  const spawnFn = (...args) => {
    calls.push(args);
    return fakeChild;
  };

  const child = startExecutionBackendRun({
    backend: "cli",
    codexBin: "codex",
    args: ["exec", "-o", "/tmp/out"],
    cwd: "/repo",
    env: { HOME: "/tmp/home", PATH: "/usr/bin" },
    spawnFn,
  });

  assert.equal(child, fakeChild);
  assert.deepEqual(calls, [["codex", ["exec", "-o", "/tmp/out"], { cwd: "/repo", env: { HOME: "/tmp/home", PATH: "/usr/bin" }, stdio: ["ignore", "pipe", "pipe"] }]]);
});

test("runtime/execution_backend/start: ws backend prepends remote args and optional auth env flag", () => {
  const fakeChild = new EventEmitter();
  const calls = [];
  const spawnFn = (...args) => {
    calls.push(args);
    return fakeChild;
  };

  const child = startExecutionBackendRun({
    backend: "ws",
    codexBin: "codex",
    args: ["exec", "-o", "/tmp/out"],
    cwd: "/repo",
    env: { HOME: "/tmp/home", PATH: "/usr/bin" },
    wsBackendUrl: "ws://127.0.0.1:18766",
    wsBackendAuthTokenEnv: "CODEX_WS_BACKEND_TOKEN",
    spawnFn,
  });

  assert.equal(child, fakeChild);
  assert.deepEqual(calls, [[
    "codex",
    [
      "--remote",
      "ws://127.0.0.1:18766",
      "--remote-auth-token-env",
      "CODEX_WS_BACKEND_TOKEN",
      "exec",
      "-o",
      "/tmp/out",
    ],
    { cwd: "/repo", env: { HOME: "/tmp/home", PATH: "/usr/bin" }, stdio: ["ignore", "pipe", "pipe"] },
  ]]);
});

test("runtime/execution_backend/start: ws backend fails closed when url is missing", () => {
  assert.throws(
    () =>
      startExecutionBackendRun({
        backend: "ws",
        codexBin: "codex",
        args: ["exec"],
        cwd: "/repo",
        env: {},
        wsBackendUrl: "",
      }),
    /ws backend requires wsBackendUrl/i,
  );
});


test("runtime/execution_backend/start: ws backend fails closed when url protocol is not ws/wss", () => {
  assert.throws(
    () =>
      startExecutionBackendRun({
        backend: "ws",
        codexBin: "codex",
        args: ["exec"],
        cwd: "/repo",
        env: {},
        wsBackendUrl: "http://127.0.0.1:18766",
      }),
    /invalid ws backend url/i,
  );
});

test("runtime/execution_backend/events: cli and ws backend both wire stdout/stderr/error/close handlers", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const stdoutChunks = [];
  const stderrChunks = [];
  const errors = [];
  const closes = [];

  attachExecutionBackendHandlers({
    backend: "ws",
    child,
    onStdout: (chunk) => stdoutChunks.push(String(chunk)),
    onStderr: (chunk) => stderrChunks.push(String(chunk)),
    onError: (error) => errors.push(error?.message ?? String(error)),
    onClose: (code, signal) => closes.push({ code, signal }),
  });

  child.stdout.emit("data", Buffer.from("stdout-line"));
  child.stderr.emit("data", Buffer.from("stderr-line"));
  child.emit("error", new Error("spawn failed"));
  child.emit("close", 2, "SIGTERM");

  assert.deepEqual(stdoutChunks, ["stdout-line"]);
  assert.deepEqual(stderrChunks, ["stderr-line"]);
  assert.deepEqual(errors, ["spawn failed"]);
  assert.deepEqual(closes, [{ code: 2, signal: "SIGTERM" }]);
});
