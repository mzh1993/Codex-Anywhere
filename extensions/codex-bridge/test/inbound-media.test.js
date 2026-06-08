import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveInboundMedia } from "../lib/inbound-media.js";

test("runtime/policy/inbound_media: image attachments normalize into run-scoped local files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-inbound-media-unit-"));
  const result = await resolveInboundMedia({
    inboundMediaRoot: path.join(tempRoot, "inbound-media"),
    runId: "run-1",
    messageId: "om_1",
    attachments: [{ kind: "image", imageKey: "img_v3_test", name: "photo.png" }],
    downloader: async () => ({
      buffer: Buffer.from("fake"),
      fileName: "photo.png",
      contentType: "image/png",
    }),
  });

  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].kind, "image");
  assert.match(result.attachments[0].localPath, /inbound-media[\/\\]run-1[\/\\]photo\.png$/);
  assert.equal(result.attachments[0].contentType, "image/png");
  assert.equal(result.attachments[0].source.imageKey, "img_v3_test");
  assert.equal(result.failures.length, 0);
});

test("runtime/policy/inbound_media: download failures stay aggregated and do not block text delivery", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-inbound-media-failure-"));
  const result = await resolveInboundMedia({
    inboundMediaRoot: path.join(tempRoot, "inbound-media"),
    runId: "run-2",
    messageId: "om_2",
    attachments: [{ kind: "audio", fileKey: "file_v3_test", name: "note.m4a" }],
    downloader: async () => {
      throw new Error("403");
    },
  });

  assert.equal(result.attachments.length, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].kind, "audio");
  assert.equal(result.failures[0].code, "download_failed");
});
