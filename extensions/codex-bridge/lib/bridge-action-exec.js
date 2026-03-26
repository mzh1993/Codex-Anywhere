import { normalizeBridgeActionContract } from "./bridge-action-model.js";

export function buildBridgeActionExecution(action, paths = {}) {
  const contract = normalizeBridgeActionContract(action?.contract ?? action);
  assertBridgeActionContractMatchesAction(action, contract);

  if (contract.kind === "service_control") {
    if (contract.executor !== "systemd_user") {
      throw new Error(`unsupported bridge action contract executor: ${contract.executor}`);
    }
    return {
      command: "systemctl",
      args: ["--user", contract.operation, contract.target],
    };
  }

  if (contract.kind === "gateway_health") {
    if (contract.executor !== "isolated_openclaw") {
      throw new Error(`unsupported bridge action contract executor: ${contract.executor}`);
    }
    return {
      command: "bash",
      args: [requirePath(paths.isolatedOpenClawScriptPath, "isolatedOpenClawScriptPath"), "health", "--json"],
    };
  }

  if (contract.kind === "install_lifecycle") {
    if (contract.executor !== "bootstrap_script") {
      throw new Error(`unsupported bridge action contract executor: ${contract.executor}`);
    }
    return {
      command: "bash",
      args: [requirePath(paths.bootstrapScriptPath, "bootstrapScriptPath"), "install-systemd"],
    };
  }

  if (contract.kind === "diagnostic") {
    if (contract.executor !== "bootstrap_script") {
      throw new Error(`unsupported bridge action contract executor: ${contract.executor}`);
    }
    return {
      command: "bash",
      args: [requirePath(paths.bootstrapScriptPath, "bootstrapScriptPath"), "gateway-status"],
    };
  }

  throw new Error(`unsupported bridge action kind: ${contract.kind}`);
}

function requirePath(value, fieldName) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`missing ${fieldName} for bridge action execution`);
}

function assertBridgeActionContractMatchesAction(action, contract) {
  if (!action || !contract) {
    throw new Error("missing bridge action contract");
  }
  for (const key of ["kind", "operation", "target"]) {
    if (action[key] != null && contract[key] != null && action[key] !== contract[key]) {
      throw new Error(`bridge action contract mismatch for ${key}`);
    }
  }
}
