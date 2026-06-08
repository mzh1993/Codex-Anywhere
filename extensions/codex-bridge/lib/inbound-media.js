import fsp from "node:fs/promises";
import path from "node:path";

export async function resolveInboundMedia({
  inboundMediaRoot,
  runId,
  messageId,
  attachments = [],
  downloader,
}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (normalizedAttachments.length === 0) {
    return {
      attachments: [],
      failures: [],
    };
  }

  const runRoot = path.join(inboundMediaRoot, runId);
  await fsp.mkdir(runRoot, { recursive: true });

  const resolved = [];
  const failures = [];
  for (const attachment of normalizedAttachments) {
    try {
      const downloaded = await downloader(attachment, { messageId });
      const fileName = safeInboundFileName(downloaded?.fileName || attachment?.name || attachment?.kind || "attachment");
      const localPath = path.join(runRoot, fileName);
      const buffer = normalizeBuffer(downloaded?.buffer);
      await fsp.writeFile(localPath, buffer);
      resolved.push({
        kind: normalizeText(attachment?.kind) || "file",
        name: fileName,
        localPath,
        contentType: normalizeText(downloaded?.contentType),
        source: attachment,
      });
    } catch (error) {
      failures.push({
        kind: normalizeText(attachment?.kind) || "file",
        code: "download_failed",
        message: String(error),
      });
    }
  }

  return {
    attachments: resolved,
    failures,
  };
}

function normalizeBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  return Buffer.alloc(0);
}

function safeInboundFileName(value) {
  const normalized = normalizeText(value).replace(/[\\/:*?"<>|]+/g, "-");
  return normalized || "attachment";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
