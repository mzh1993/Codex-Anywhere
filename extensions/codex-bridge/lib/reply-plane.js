import fsp from "node:fs/promises";
import path from "node:path";

import { isPathInside } from "./fs-utils.js";

const LOCAL_KINDS = new Set(["file", "image", "audio", "video"]);
const SUPPORTED_KINDS = new Set([...LOCAL_KINDS, "link"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".tiff"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);

export function parseDeliveryManifest(text) {
  const section = extractDeliveryManifestSection(text);
  if (!section) return { manifest: null, errorCode: null };
  const jsonText = extractJsonBlock(section);
  if (!jsonText) return { manifest: null, errorCode: "manifest_missing_json" };

  try {
    const raw = JSON.parse(jsonText);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { manifest: null, errorCode: "manifest_invalid_shape" };
    }
    return {
      manifest: {
        summary: normalizeText(raw.summary),
        note: normalizeText(raw.note),
        deliverables: Array.isArray(raw.deliverables) ? raw.deliverables.map(normalizeDeliverable) : [],
      },
      errorCode: null,
    };
  } catch {
    return { manifest: null, errorCode: "manifest_invalid_json" };
  }
}

export async function validateDeclaredDeliverables({ cwd, deliverables }) {
  const accepted = [];
  const failures = [];
  const normalizedCwd = path.resolve(cwd);
  const realCwd = await fsp.realpath(normalizedCwd).catch(() => normalizedCwd);

  for (const entry of Array.isArray(deliverables) ? deliverables : []) {
    const deliverable = normalizeDeliverable(entry);
    if (!SUPPORTED_KINDS.has(deliverable.kind)) {
      failures.push({ ...deliverable, code: "unsupported_kind" });
      continue;
    }

    if (deliverable.kind === "link") {
      if (!/^https?:\/\//i.test(deliverable.url)) {
        failures.push({ ...deliverable, code: "invalid_link_url" });
        continue;
      }
      accepted.push(deliverable);
      continue;
    }

    if (!deliverable.path) {
      failures.push({ ...deliverable, code: "missing_path" });
      continue;
    }
    if (path.isAbsolute(deliverable.path)) {
      failures.push({ ...deliverable, code: "absolute_path_not_allowed" });
      continue;
    }
    if (hasParentTraversal(deliverable.path)) {
      failures.push({ ...deliverable, code: "path_outside_cwd" });
      continue;
    }

    const resolvedPath = path.resolve(normalizedCwd, deliverable.path);
    if (!isPathInside(resolvedPath, normalizedCwd)) {
      failures.push({ ...deliverable, code: "path_outside_cwd" });
      continue;
    }

    const stat = await fsp.stat(resolvedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      failures.push({ ...deliverable, code: "file_not_found" });
      continue;
    }

    const realPath = await fsp.realpath(resolvedPath).catch(() => resolvedPath);
    if (!isPathInside(realPath, realCwd)) {
      failures.push({ ...deliverable, code: "path_outside_cwd" });
      continue;
    }

    if (!matchesDeclaredKind(deliverable.kind, resolvedPath)) {
      failures.push({ ...deliverable, code: "kind_mismatch" });
      continue;
    }

    accepted.push({
      ...deliverable,
      resolvedPath,
      fileName: path.basename(resolvedPath),
    });
  }

  return { accepted, failures };
}

export function summarizeDeliveryFailures({ locale, failures }) {
  const normalizedLocale = /^zh(?:[-_].*)?$/i.test(normalizeText(locale)) ? "zh-CN" : "en-US";
  const normalizedFailures = Array.isArray(failures) ? failures.filter(Boolean) : [];
  if (normalizedFailures.length === 0) return "";
  const uniqueLabels = Array.from(new Set(normalizedFailures.map((failure) => localizeFailureCode(normalizedLocale, failure.code))));
  const labels = uniqueLabels.slice(0, 3).join(normalizedLocale === "zh-CN" ? "、" : ", ");
  if (normalizedLocale === "zh-CN") {
    return `${normalizedFailures.length} 个产物未回传：${labels}`;
  }
  return `${normalizedFailures.length} deliverable${normalizedFailures.length === 1 ? "" : "s"} skipped: ${labels}`;
}

function extractDeliveryManifestSection(text) {
  const normalized = typeof text === "string" ? text : "";
  if (!normalized) return "";
  const match = normalized.match(/(?:^|\n)\s*(?:Delivery Manifest|交付清单|回传清单)\s*\n([\s\S]*)$/i);
  return match?.[1]?.trim() ?? "";
}

function extractJsonBlock(section) {
  const fencedMatch = section.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) return normalizeText(fencedMatch[1]);
  return normalizeText(section);
}

function normalizeDeliverable(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { kind: "", path: "", url: "", note: "" };
  }
  return {
    kind: normalizeText(entry.kind).toLowerCase(),
    path: normalizeText(entry.path),
    url: normalizeText(entry.url),
    note: normalizeText(entry.note),
  };
}

function hasParentTraversal(value) {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}

function matchesDeclaredKind(kind, filePath) {
  if (kind === "file") return true;
  const extension = path.extname(filePath).toLowerCase();
  if (kind === "image") return IMAGE_EXTENSIONS.has(extension);
  if (kind === "audio") return AUDIO_EXTENSIONS.has(extension);
  if (kind === "video") return VIDEO_EXTENSIONS.has(extension);
  return false;
}

function localizeFailureCode(locale, code) {
  const normalizedCode = normalizeText(code);
  if (locale === "zh-CN") {
    const labels = {
      absolute_path_not_allowed: "路径越界",
      path_outside_cwd: "路径越界",
      file_not_found: "文件不存在",
      kind_mismatch: "类型不匹配",
      upload_failed: "上传失败",
      invalid_link_url: "链接无效",
      unsupported_kind: "类型不支持",
      missing_path: "路径缺失",
    };
    return labels[normalizedCode] ?? "回传失败";
  }
  const labels = {
    absolute_path_not_allowed: "path escape",
    path_outside_cwd: "path escape",
    file_not_found: "missing file",
    kind_mismatch: "kind mismatch",
    upload_failed: "upload failed",
    invalid_link_url: "invalid link",
    unsupported_kind: "unsupported kind",
    missing_path: "missing path",
  };
  return labels[normalizedCode] ?? "delivery failed";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
