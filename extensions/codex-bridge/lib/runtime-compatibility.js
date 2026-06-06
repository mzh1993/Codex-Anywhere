import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MIN_BWRAP_VERSION = "0.9.0";
export const SYSTEM_BWRAP_BIN = "/usr/bin/bwrap";
const SANDBOX_PROBE_ARGS = [
  ["sandbox", "--", "/bin/true"],
  ["sandbox", "linux", "--", "/bin/true"],
];

export function parseVersionString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function isVersionAtLeast(version, minimum) {
  const left = typeof version === "string" ? parseVersionString(version) : version;
  const right = typeof minimum === "string" ? parseVersionString(minimum) : minimum;
  if (!left || !right) return false;
  if (left.major !== right.major) return left.major > right.major;
  if (left.minor !== right.minor) return left.minor > right.minor;
  return left.patch >= right.patch;
}

export async function detectExecutionRuntimeCompatibility({
  codexBin = "codex",
  runtimeMode = "secure_linux",
  runCommand = runVersionCommand,
} = {}) {
  const codexVersion = await readCommandResult(codexBin, ["--version"], runCommand, "missing_codex");
  if (!codexVersion.ok) {
    return {
      ok: false,
      reasonCode: codexVersion.reasonCode,
      message: `missing required command: ${codexBin}`,
    };
  }

  const isWindowsRuntime = runtimeMode === "native_windows_fast";
  if (isWindowsRuntime) {
    return {
      ok: true,
      codexVersion: extractFirstLine(codexVersion.stdout),
      bwrapVersion: "n/a (windows)",
    };
  }

  const bwrapVersion = await readCommandResult(SYSTEM_BWRAP_BIN, ["--version"], runCommand, "missing_bwrap");
  if (!bwrapVersion.ok) {
    return {
      ok: false,
      reasonCode: bwrapVersion.reasonCode,
      message: `missing required command: ${SYSTEM_BWRAP_BIN}`,
    };
  }

  const parsedBwrapVersion = parseVersionString(`${bwrapVersion.stdout}\n${bwrapVersion.stderr}`);
  if (!parsedBwrapVersion || !isVersionAtLeast(parsedBwrapVersion, MIN_BWRAP_VERSION)) {
    const detectedVersion = formatVersion(parsedBwrapVersion) ?? "unknown";
    return {
      ok: false,
      reasonCode: "unsupported_bwrap",
      message: `${SYSTEM_BWRAP_BIN} must be >= ${MIN_BWRAP_VERSION}; current ${detectedVersion}`,
      bwrapVersion: detectedVersion,
      codexVersion: extractFirstLine(codexVersion.stdout),
    };
  }

  const sandboxProbe = await probeSandboxRuntime(codexBin, runCommand);
  if (!sandboxProbe.ok) {
    return {
      ok: false,
      reasonCode: sandboxProbe.reasonCode,
      message: buildProbeFailureMessage(sandboxProbe),
      bwrapVersion: formatVersion(parsedBwrapVersion),
      codexVersion: extractFirstLine(codexVersion.stdout),
    };
  }

  return {
    ok: true,
    codexVersion: extractFirstLine(codexVersion.stdout),
    bwrapVersion: formatVersion(parsedBwrapVersion),
  };
}

async function readCommandResult(command, args, runCommand, failureReasonCode) {
  try {
    const result = await runCommand(command, args);
    return {
      ok: true,
      stdout: result?.stdout ?? "",
      stderr: result?.stderr ?? "",
    };
  } catch (error) {
    return {
      ok: false,
      reasonCode: error?.code === "ENOENT" ? failureReasonCode : failureReasonCode,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      errorText: extractFirstLine(error?.stderr ?? error?.message ?? ""),
    };
  }
}

async function probeSandboxRuntime(command, runCommand) {
  let lastFailure = null;
  for (const args of SANDBOX_PROBE_ARGS) {
    const result = await readCommandResult(command, args, runCommand, "sandbox_probe_failed");
    if (result.ok) return result;
    lastFailure = result;
  }
  return lastFailure ?? {
    ok: false,
    reasonCode: "sandbox_probe_failed",
    stderr: "",
    stdout: "",
    errorText: "",
  };
}

async function runVersionCommand(command, args) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function formatVersion(version) {
  if (!version) return null;
  return `${version.major}.${version.minor}.${version.patch}`;
}

function buildProbeFailureMessage(probeResult) {
  const detail = extractFirstLine(probeResult.stderr) || extractFirstLine(probeResult.stdout) || probeResult.errorText || "unknown sandbox error";
  return `codex sandbox linux probe failed: ${detail}`;
}

function extractFirstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/, 1)[0] ?? "";
}
