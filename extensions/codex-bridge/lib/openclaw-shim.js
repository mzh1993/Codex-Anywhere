import fsp from "node:fs/promises";
import path from "node:path";

export async function ensureIsolatedOpenClawShim({ codexHome, isolatedCliPath }) {
  if (!codexHome || !isolatedCliPath) return null;
  const shimDir = path.join(codexHome, ".npm-global", "bin");
  const shimPath = path.join(shimDir, "openclaw");
  const script = buildIsolatedOpenClawShimScript({ isolatedCliPath });

  await fsp.mkdir(shimDir, { recursive: true });
  const existing = await fsp.readFile(shimPath, "utf8").catch(() => null);
  if (existing !== script) {
    await fsp.writeFile(shimPath, script, { mode: 0o755 });
  }
  await fsp.chmod(shimPath, 0o755);
  return shimPath;
}

export function buildIsolatedOpenClawShimScript({ isolatedCliPath }) {
  return `#!/usr/bin/env bash
set -euo pipefail

unset OPENCLAW_GATEWAY_URL
unset OPENCLAW_GATEWAY_TOKEN
unset OPENCLAW_ALLOW_INSECURE_PRIVATE_WS
unset OPENCLAW_SECRETS_ENV_PATH

exec ${shellQuote(isolatedCliPath)} "$@"
`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}
