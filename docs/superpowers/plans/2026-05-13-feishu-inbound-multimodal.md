# Feishu Inbound Multimodal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu image/audio/file/video messages enter the existing Codex task lane as ordinary user input with attached media context, without adding a new bridge command surface or second interaction model.

**Architecture:** Keep bridge ownership and command semantics unchanged: ordinary inbound messages remain Codex-owned, while bridge only normalizes Feishu media shells into a thin inbound attachment envelope. Downloaded media stays in bridge-managed state, is referenced in the Codex prompt as run-scoped attachment context, and fails closed when metadata or download is invalid. Same-origin reply-plane, approval boundaries, continuity, and group claim semantics remain unchanged.

**Tech Stack:** Node.js, existing `extensions/codex-bridge` runtime, Feishu/OpenClaw runtime injection patching, Node test runner, existing runtime compatibility and policy tests

---

### Task 1: Lock Product Semantics And Governance

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `docs/contract-matrix.md`
- Modify: `README.md`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing protocol/documentation-facing test**

```js
test("runtime/protocol/inbound_media: ordinary text plus image stays codex-owned and carries attachment context without bridge chatter", async () => {
  const bridge = createTestBridge();
  const started = [];
  bridge.startTask = async (params) => {
    started.push(params);
  };

  await bridge.handleInboundClaim({
    channel: "feishu",
    accountId: "default",
    conversationId: "oc_dm_1",
    senderId: "ou_user_1",
    messageId: "om_media_1",
    isGroup: false,
    bodyForAgent: "看看这张图",
    media: [
      {
        kind: "image",
        name: "image.png",
        imageKey: "img_v3_test",
      },
    ],
  }, {
    channelId: "feishu",
    accountId: "default",
    conversationId: "oc_dm_1",
    senderId: "ou_user_1",
    messageId: "om_media_1",
  });

  assert.equal(started.length, 1);
  assert.equal(started[0].prompt, "看看这张图");
  assert.equal(started[0].inputAttachments?.[0]?.kind, "image");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL because `inputAttachments` is not preserved and media-aware inbound protocol does not exist yet.

- [ ] **Step 3: Update the product-facing docs in the same change**

```md
## Inbound Input Semantics

- 普通 Feishu 消息仍默认归 `Codex`
- 文本、图片、音频、视频、文件都属于同一条普通用户输入的可能组成部分
- bridge 只负责把飞书媒体外壳规范化成受控附件上下文，不新增媒体专用命令面
- 媒体下载失败时 fail closed：文本仍进入任务，失败原因只保留最小上下文提示
```

Add one new active contract row in `docs/contract-matrix.md` covering:

```md
| PB-009 | product-north-star + roadmap | Inbound Feishu media should remain ordinary Codex-owned input semantics; bridge may normalize media into run-scoped attachment context, but must not add a second media-specific command surface or special ownership mode. | active | both | cross-platform | routing, policy, runtime_compat, persistence | Proof: `runtime/protocol/inbound_media:*` |
```

- [ ] **Step 4: Run the targeted test and inspect docs diff**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: still FAIL in runtime, but docs and contract text now reflect the intended behavior.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/feishu-codex-bridge-v1.md docs/contract-matrix.md extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "docs: define inbound multimodal codex-owned semantics"
```

### Task 2: Thread Feishu Media Metadata Through The Inbound Claim Boundary

**Files:**
- Modify: `scripts/bootstrap-codex-feishu.sh`
- Modify: `scripts/install.ps1`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing runtime test for boundary propagation**

```js
test("runtime/protocol/inbound_media: claim patch preserves raw media metadata from feishu ctx", async () => {
  const bridge = createTestBridge();
  let capturedRequest = null;
  bridge.routeInbound = async (request) => {
    capturedRequest = request;
  };

  await bridge.handleInboundClaim({
    channel: "feishu",
    accountId: "default",
    conversationId: "oc_dm_1",
    senderId: "ou_user_1",
    messageId: "om_media_2",
    isGroup: false,
    bodyForAgent: "识别一下",
    messageType: "image",
    media: [{ kind: "image", imageKey: "img_v3_test", name: "shot.png" }],
  }, {
    channelId: "feishu",
    accountId: "default",
    conversationId: "oc_dm_1",
    senderId: "ou_user_1",
    messageId: "om_media_2",
  });

  assert.equal(capturedRequest.messageType, "image");
  assert.equal(capturedRequest.media?.[0]?.imageKey, "img_v3_test");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL because `routeInbound()` currently only receives text fields.

- [ ] **Step 3: Implement the patch boundary and request shape**

Update the Feishu claim injection in both installer templates so the bridge receives structured media fields when present:

```js
const claimResult = await codexBridgeClaim({
  channel: "feishu",
  accountId: account.accountId,
  conversationId: ctx.chatId,
  parentConversationId,
  senderId: ctx.senderOpenId,
  senderName: ctx.senderName ?? ctx.senderOpenId,
  messageId: ctx.messageId,
  isGroup,
  content: ctx.content,
  body: ctx.content,
  bodyForAgent: ctx.content,
  messageType: ctx.messageType ?? ctx.msgType ?? "",
  rawContent: ctx.rawContent ?? "",
  media: Array.isArray(ctx.media) ? ctx.media : [],
}, {
  channelId: "feishu",
  accountId: account.accountId,
  conversationId: ctx.chatId,
  parentConversationId,
  senderId: ctx.senderOpenId,
  messageId: ctx.messageId,
});
```

Update `handleInboundClaim()` and `routeInbound()` to preserve:

```js
const messageType = normalizeText(event.messageType ?? "");
const media = Array.isArray(event.media) ? event.media : [];

void this.routeInbound({
  accountId,
  conversationId,
  messageId,
  senderId,
  senderName: event.senderName ?? "",
  text,
  messageType,
  rawContent: event.rawContent ?? "",
  media,
});
```

- [ ] **Step 4: Persist inbound attachment metadata on the task/run path**

Extend task creation inputs so new runs can carry normalized attachments:

```js
return {
  taskId: input.taskId,
  // existing fields...
  inputAttachments: Array.isArray(input.inputAttachments) ? input.inputAttachments : [],
  inputMessageType: input.inputMessageType ?? "text",
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS for propagation assertions; no regression in plain-text claim behavior.

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap-codex-feishu.sh scripts/install.ps1 extensions/codex-bridge/index.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "feat: preserve inbound feishu media metadata in bridge claim"
```

### Task 3: Add A Thin Inbound Media Resolver

**Files:**
- Create: `extensions/codex-bridge/lib/inbound-media.js`
- Modify: `extensions/codex-bridge/lib/settings.js`
- Modify: `extensions/codex-bridge/index.js`
- Test: `extensions/codex-bridge/test/inbound-media.test.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing unit tests for normalization and fail-closed download rules**

```js
test("runtime/policy/inbound_media: image attachments normalize into run-scoped local files", async () => {
  const resolved = await resolveInboundMedia({
    stateRoot: "/tmp/codex-bridge",
    runId: "run-1",
    messageId: "om_1",
    attachments: [{ kind: "image", imageKey: "img_v3_test", name: "photo.png" }],
    downloader: async () => ({
      buffer: Buffer.from("fake"),
      fileName: "photo.png",
      contentType: "image/png",
    }),
  });

  assert.equal(resolved.attachments[0].kind, "image");
  assert.match(resolved.attachments[0].localPath, /inbound-media\/run-1\//);
  assert.equal(resolved.failures.length, 0);
});

test("runtime/policy/inbound_media: download failures stay aggregated and do not block text delivery", async () => {
  const resolved = await resolveInboundMedia({
    stateRoot: "/tmp/codex-bridge",
    runId: "run-2",
    messageId: "om_2",
    attachments: [{ kind: "audio", fileKey: "file_v3_test", name: "note.m4a" }],
    downloader: async () => {
      throw new Error("403");
    },
  });

  assert.equal(resolved.attachments.length, 0);
  assert.equal(resolved.failures[0].kind, "audio");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/inbound-media.test.js`
Expected: FAIL because resolver module does not exist.

- [ ] **Step 3: Implement the resolver module**

Create `extensions/codex-bridge/lib/inbound-media.js` with a thin interface:

```js
export async function resolveInboundMedia({
  stateRoot,
  runId,
  messageId,
  attachments = [],
  downloader,
}) {
  const inboundRoot = path.join(stateRoot, "inbound-media", runId);
  await fsp.mkdir(inboundRoot, { recursive: true });

  const resolved = [];
  const failures = [];
  for (const attachment of attachments) {
    try {
      const downloaded = await downloader(attachment, { messageId });
      const fileName = safeInboundFileName(downloaded.fileName || attachment.name || attachment.kind);
      const localPath = path.join(inboundRoot, fileName);
      await fsp.writeFile(localPath, downloaded.buffer);
      resolved.push({
        kind: attachment.kind,
        name: fileName,
        localPath,
        contentType: downloaded.contentType ?? "",
        source: attachment,
      });
    } catch (error) {
      failures.push({
        kind: attachment.kind,
        code: "download_failed",
        message: String(error),
      });
    }
  }

  return { attachments: resolved, failures };
}
```

- [ ] **Step 4: Add settings for bridge-managed inbound media storage**

Keep this internal and non-user-facing:

```js
return {
  // existing settings...
  inboundMediaRoot: path.join(stateRoot, "inbound-media"),
};
```

- [ ] **Step 5: Wire the resolver into run startup**

Before building the Codex prompt, resolve inbound media for the run:

```js
const inboundMedia = await resolveInboundMedia({
  stateRoot: this.settings.stateRoot,
  runId,
  messageId: params.messageId,
  attachments: normalizeInboundAttachmentList(params.media),
  downloader: (attachment, ctx) => this.downloadFeishuInboundMedia(attachment, ctx),
});
```

Store both successful attachments and aggregated failure hints on task/run state for later prompt/presentation use.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test extensions/codex-bridge/test/inbound-media.test.js extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS for resolver unit tests and runtime propagation with no plain-text regressions.

- [ ] **Step 7: Commit**

```bash
git add extensions/codex-bridge/lib/inbound-media.js extensions/codex-bridge/lib/settings.js extensions/codex-bridge/index.js extensions/codex-bridge/test/inbound-media.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "feat: add thin inbound feishu media resolver"
```

### Task 4: Render Inbound Attachments Into Codex Context Without Creating A New Interaction Mode

**Files:**
- Modify: `extensions/codex-bridge/lib/codex-exec.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Test: `extensions/codex-bridge/test/codex-exec.test.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing prompt-shape test**

```js
test("runtime/exec/inbound_media: prompt includes ordinary user text plus attachment context", () => {
  const prompt = buildBridgeTaskPrompt({
    task: {
      cwd: "/repo",
      mode: "new",
      locale: "zh-CN",
      prompt: "帮我看这张图里有什么",
      inputAttachments: [
        {
          kind: "image",
          name: "photo.png",
          localPath: "/state/codex-bridge/inbound-media/run-1/photo.png",
          contentType: "image/png",
        },
      ],
    },
    settings: {},
  });

  assert.match(prompt, /User task:/);
  assert.match(prompt, /帮我看这张图里有什么/);
  assert.match(prompt, /Inbound attachments:/);
  assert.match(prompt, /photo\.png/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js`
Expected: FAIL because prompt builder does not emit inbound attachment context.

- [ ] **Step 3: Implement the minimal prompt rendering**

Add a helper in `extensions/codex-bridge/lib/codex-exec.js`:

```js
function buildInboundAttachmentSection(task) {
  if (!Array.isArray(task.inputAttachments) || task.inputAttachments.length === 0) return [];
  const lines = ["", "Inbound attachments:"];
  for (const attachment of task.inputAttachments) {
    lines.push(`- kind: ${attachment.kind}`);
    lines.push(`  name: ${attachment.name}`);
    lines.push(`  path: ${attachment.localPath}`);
    if (attachment.contentType) lines.push(`  content_type: ${attachment.contentType}`);
  }
  return lines;
}
```

Append it immediately before `User task:`:

```js
policyLines.push(...buildInboundAttachmentSection(task));
policyLines.push("");
policyLines.push("User task:");
policyLines.push(task.prompt);
```

- [ ] **Step 4: Preserve inbound failure hints without bridge takeover**

If downloads fail, keep them concise inside prompt context rather than emitting new bridge-owned UX:

```js
if (Array.isArray(task.inputAttachmentFailures) && task.inputAttachmentFailures.length > 0) {
  policyLines.push("");
  policyLines.push("Inbound attachment issues:");
  for (const failure of task.inputAttachmentFailures.slice(0, 3)) {
    policyLines.push(`- ${failure.kind}: ${failure.code}`);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS; mixed text-plus-media uses the same Codex task lane and prompt contract.

- [ ] **Step 6: Commit**

```bash
git add extensions/codex-bridge/lib/codex-exec.js extensions/codex-bridge/index.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "feat: inject inbound media context into codex task prompts"
```

### Task 5: Cover Feishu-Specific Download Semantics, Continuity, And Regressions

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/runtime-contract.test.js`
- Modify: `docs/experience-regression-checklist.md`

- [ ] **Step 1: Write failing end-to-end runtime coverage**

```js
test("runtime/protocol/inbound_media: image messages download through feishu resource APIs and stay on the same task lane", async () => {
  const bridge = createTestBridge();
  const downloads = [];
  bridge.downloadFeishuInboundMedia = async (attachment) => {
    downloads.push(attachment);
    return {
      buffer: Buffer.from("img"),
      fileName: "image.png",
      contentType: "image/png",
    };
  };

  await bridge.handleInboundClaim(buildFeishuMediaEvent(), buildFeishuClaimCtx());

  assert.equal(downloads[0].kind, "image");
  assert.equal(downloads[0].imageKey, "img_v3_test");
});

test("runtime/protocol/inbound_media: download failure does not block plain-text continuation", async () => {
  const bridge = createTestBridge();
  bridge.downloadFeishuInboundMedia = async () => {
    throw new Error("403");
  };

  await bridge.handleInboundClaim(buildFeishuMediaEvent({ bodyForAgent: "继续分析", media: [{ kind: "image", imageKey: "img_v3_test" }] }), buildFeishuClaimCtx());

  assert.equal(bridge.safeReplyEvents.length, 0);
  assert.equal(bridge.startedTasks.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js`
Expected: FAIL because there is no download adapter and no continuity/media regression coverage.

- [ ] **Step 3: Implement Feishu download adapter with thin platform branching**

Inside `extensions/codex-bridge/index.js`, add one bridge-local method:

```js
async downloadFeishuInboundMedia(attachment, { messageId }) {
  if (attachment.imageKey) {
    return await this.api.feishu.im.v1.image.get({
      path: { image_key: attachment.imageKey },
      responseType: "arraybuffer",
    });
  }
  if (attachment.fileKey && messageId) {
    return await this.api.feishu.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: attachment.fileKey },
      responseType: "arraybuffer",
    });
  }
  throw new Error("unsupported_attachment");
}
```

Keep all failures local to attachment resolution; do not add retry UI, new commands, or special approval flows in this phase.

- [ ] **Step 4: Update regression checklist**

Add one new experience replay item:

```md
1. 在配对 DM 发一条“帮我看这张图”并附一张图片
2. 观察 bridge 不发送额外控制面提示
3. 观察 Codex run 正常启动，最终回答体现图片上下文
4. 断开图片下载能力时，文本仍继续进入同一任务 lane
```

- [ ] **Step 5: Run the full bridge test suite**

Run: `node --test extensions/codex-bridge/test/*.test.js`
Expected: PASS across routing, policy, runtime compatibility, reply-plane, persistence, and contract coverage.

- [ ] **Step 6: Commit**

```bash
git add extensions/codex-bridge/index.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js docs/experience-regression-checklist.md
git commit -m "test: cover inbound multimodal continuity and feishu download path"
```

### Task 6: Final Verification And Release Notes

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/feishu-codex-bridge-v1.md`

- [ ] **Step 1: Reconcile outward-facing product language with landed behavior**

Add concise release-ready wording:

```md
- 普通 Feishu 输入现在可包含文本与媒体附件，默认仍直达 `Codex`
- bridge 只做受控媒体归一化，不新增媒体命令面
- 当前阶段支持图片、音频、视频、文件的入站上下文接入；更复杂的对象协作仍留在后续阶段
```

- [ ] **Step 2: Run the verification bundle**

Run: `node --test extensions/codex-bridge/test/*.test.js`
Expected: PASS

Run: `git diff --stat`
Expected: only planned bridge/runtime/test/doc files are changed

- [ ] **Step 3: Commit**

```bash
git add README.md docs/roadmap.md docs/feishu-codex-bridge-v1.md
git commit -m "docs: align product narrative with inbound multimodal support"
```
