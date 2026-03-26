import test from "node:test";
import assert from "node:assert/strict";

import { buildBridgeActionExecution } from "../lib/bridge-action-exec.js";

test("runtime/control-plane/exec: owned service control uses the user systemd manager", () => {
  assert.deepEqual(
    buildBridgeActionExecution(
      {
        kind: "service_control",
        operation: "restart",
        target: "openclaw-codex-feishu.service",
      },
      {
        isolatedOpenClawScriptPath: "/repo/scripts/openclaw-isolated.sh",
        bootstrapScriptPath: "/repo/scripts/bootstrap-codex-feishu.sh",
      },
    ),
    {
      command: "systemctl",
      args: ["--user", "restart", "openclaw-codex-feishu.service"],
    },
  );
});

test("runtime/control-plane/exec: execution fails closed when stored contract mismatches the action record", () => {
  assert.throws(
    () =>
      buildBridgeActionExecution(
        {
          kind: "service_control",
          operation: "restart",
          target: "openclaw-codex-feishu.service",
          contract: {
            kind: "diagnostic",
            operation: "gateway-status",
            target: "bridge",
            executor: "bootstrap_script",
          },
        },
        {
          isolatedOpenClawScriptPath: "/repo/scripts/openclaw-isolated.sh",
          bootstrapScriptPath: "/repo/scripts/bootstrap-codex-feishu.sh",
        },
      ),
    /contract/i,
  );
});
