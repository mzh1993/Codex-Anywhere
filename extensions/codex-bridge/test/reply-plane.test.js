import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseDeliveryManifest, summarizeDeliveryFailures, validateDeclaredDeliverables } from "../lib/reply-plane.js";

test("runtime/policy/reply_plane: parses the final delivery manifest from the terminal section only", () => {
  const parsed = parseDeliveryManifest(`Summary
已完成报告整理。

Changed Files
\`reports/final.md\`

Next Steps
- 如需继续，我可以再补一页执行摘要。

Delivery Manifest
\`\`\`json
{
  "summary": "已完成报告整理。",
  "deliverables": [
    { "kind": "file", "path": "reports/final.pdf" },
    { "kind": "link", "url": "https://example.com/final-report" }
  ]
}
\`\`\`
`);

  assert.equal(parsed.errorCode, null);
  assert.deepEqual(parsed.manifest, {
    summary: "已完成报告整理。",
    note: "",
    deliverables: [
      { kind: "file", path: "reports/final.pdf", url: "", note: "" },
      { kind: "link", path: "", url: "https://example.com/final-report", note: "" },
    ],
  });
});

test("runtime/policy/reply_plane: parses markdown-styled manifest headings and accepts type as a kind alias", () => {
  const parsed = parseDeliveryManifest(`**Summary**
- 已生成架构图。

**Delivery Manifest**
\`\`\`json
{
  "summary": "已生成架构图。",
  "deliverables": [
    { "type": "file", "path": "reports/architecture.svg" },
    { "type": "link", "url": "https://example.com/architecture" }
  ]
}
\`\`\`
`);

  assert.equal(parsed.errorCode, null);
  assert.deepEqual(parsed.manifest, {
    summary: "已生成架构图。",
    note: "",
    deliverables: [
      { kind: "file", path: "reports/architecture.svg", url: "", note: "" },
      { kind: "link", path: "", url: "https://example.com/architecture", note: "" },
    ],
  });
});

test("runtime/policy/reply_plane: normalizes html deliverables to file delivery", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reply-plane-html-"));
  const workspace = path.join(tempRoot, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "directory-governance.html"), "<!doctype html>");

  const result = await validateDeclaredDeliverables({
    cwd: workspace,
    deliverables: [
      { kind: "html", path: "directory-governance.html", url: "", note: "" },
    ],
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].kind, "file");
  assert.equal(result.accepted[0].path, "directory-governance.html");
});

test("runtime/policy/reply_plane: accepts file as a path alias for local deliverables", () => {
  const parsed = parseDeliveryManifest(`Delivery Manifest
```json
{
  "summary": "回传单一音频。",
  "deliverables": [
    { "type": "audio", "file": "services/voxcpm2/outputs/final.mp3" }
  ]
}
```
`);

  assert.equal(parsed.errorCode, null);
  assert.deepEqual(parsed.manifest, {
    summary: "回传单一音频。",
    note: "",
    deliverables: [
      { kind: "audio", path: "services/voxcpm2/outputs/final.mp3", url: "", note: "" },
    ],
  });
});

test("runtime/policy/reply_plane: declared local deliverables fail closed on absolute paths, escapes, symlink escapes, missing files, and kind mismatch", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reply-plane-"));
  const workspace = path.join(tempRoot, "workspace");
  const reportsDir = path.join(workspace, "reports");
  const outsideDir = path.join(tempRoot, "outside");
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });

  const goodFile = path.join(reportsDir, "final.pdf");
  const mismatchFile = path.join(reportsDir, "chart.pdf");
  const outsideFile = path.join(outsideDir, "secret.txt");
  const symlinkPath = path.join(workspace, "escape-link.txt");
  await fs.writeFile(goodFile, "pdf");
  await fs.writeFile(mismatchFile, "not an image");
  await fs.writeFile(outsideFile, "secret");
  await fs.symlink(outsideFile, symlinkPath);

  const result = await validateDeclaredDeliverables({
    cwd: workspace,
    deliverables: [
      { kind: "file", path: "reports/final.pdf", url: "", note: "" },
      { kind: "file", path: goodFile, url: "", note: "" },
      { kind: "file", path: "../outside/secret.txt", url: "", note: "" },
      { kind: "file", path: "escape-link.txt", url: "", note: "" },
      { kind: "file", path: "reports/missing.pdf", url: "", note: "" },
      { kind: "image", path: "reports/chart.pdf", url: "", note: "" },
    ],
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].path, "reports/final.pdf");
  assert.deepEqual(
    result.failures.map((entry) => entry.code),
    ["absolute_path_not_allowed", "path_outside_cwd", "path_outside_cwd", "file_not_found", "kind_mismatch"],
  );
});

test("runtime/presentation/reply_plane: delivery failure summary stays short and aggregated", () => {
  const hint = summarizeDeliveryFailures({
    locale: "zh-CN",
    failures: [
      { code: "path_outside_cwd" },
      { code: "upload_failed" },
    ],
  });

  assert.equal(hint, "2 个产物未回传：路径越界、上传失败");
});

test("runtime/policy/reply_plane: declared svg image deliverables degrade to file delivery", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reply-plane-svg-"));
  const workspace = path.join(tempRoot, "workspace");
  const reportsDir = path.join(workspace, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const svgPath = path.join(reportsDir, "architecture.svg");
  await fs.writeFile(svgPath, "<svg></svg>");

  const result = await validateDeclaredDeliverables({
    cwd: workspace,
    deliverables: [
      { kind: "image", path: "reports/architecture.svg", url: "", note: "" },
    ],
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].kind, "file");
  assert.equal(result.accepted[0].path, "reports/architecture.svg");
});
