# Feishu 二号应用落地手册

本文档用于把 Codex 的 Feishu 接入落在**独立二号应用 / 二号 bot**上，并确保不与现有 `~/.openclaw` 冲突。

## 1. 安全边界

- 只使用本仓库隔离运行时：`$REPO_ROOT/.runtime`
- 只使用本仓库隔离状态：`$REPO_ROOT/.isolated`
- 禁止复用旧 App ID：当前旧实例 App ID 为 `cli_a9281a1ee83a1cc8`
- 禁止复用旧端口：当前旧实例 gateway 端口为 `18790`
- V1 固定私聊优先，不入群

## 2. 创建第二个 Feishu 应用

1. 登录飞书开放平台：`https://open.feishu.cn/app`
2. 创建新的**企业自建应用**
3. 开启**机器人**能力
4. 为新应用单独保存：
   - `App ID`
   - `App Secret`
5. 不要把现有 OpenClaw 正在使用的 bot、凭证、配置复制到这个新应用

## 3. 导入官方权限

在新应用的**权限管理**页面，使用**批量导入**。

- 导入文件：`docs/feishu-permissions.import.json:1`
- 这份 JSON 直接来自 OpenClaw 本机官方 Feishu 文档，不做手工裁剪

这样可以一次覆盖 V1 所需的文档、表格、卡片、消息等能力，并为后续日历 / 任务扩展保留官方权限基线。

## 4. 启动隔离实例

先在本仓库内准备隔离运行时：

```bash
cd "$REPO_ROOT"
export CODEX_FEISHU_APP_ID='cli_xxx_new'
export CODEX_FEISHU_APP_SECRET='xxx_new'
# 可选：如果不想复用 ~/.codex/auth.json 里的 OPENAI_API_KEY
# export CODEXZH_API_KEY='sk-...'
./scripts/bootstrap-codex-feishu.sh bootstrap
./scripts/bootstrap-codex-feishu.sh persist-secrets
```

模型层默认走 `codexzh/gpt-5.4`，不再要求 Codex OAuth。

前台启动隔离 gateway：

```bash
./scripts/bootstrap-codex-feishu.sh gateway-run
```

## 5. 配置事件订阅

在新应用的**事件与回调**页面：

1. 订阅方式选择**长连接**（WebSocket）
2. 至少添加以下事件：
   - `im.message.receive_v1`
   - `card.action.trigger`
3. 在**可用范围**里把目标测试用户加入，或放开到目标部门/群组
4. 创建版本并发布

说明：

- `im.message.receive_v1` 是消息入口的最低要求
- `card.action.trigger` 是交互卡片/OAuth 按钮回传所需；官方插件源码已显式注册该事件
- 如果 gateway 未启动，长连接配置可能保存失败；建议先运行 `gateway-run`
- 如果发布后仍无响应，立刻运行：

```bash
./scripts/feishu-app-audit.sh
```

若输出里看到以下任一项，说明问题在飞书控制台，不在 OpenClaw：

- `published_events=(empty)`
- 缺少 `im.message.receive_v1`
- 缺少 `card.action.trigger`
- `仅对应用创建者可见`

## 6. systemd 持久化

如果前台冒烟通过，再安装单独的 user service：

```bash
./scripts/bootstrap-codex-feishu.sh install-systemd
```

该命令会：

- 只生成独立 unit：`openclaw-codex-feishu.service`
- 加载隔离 env 文件与隔离 secrets env 文件
- 自动复用同一个隔离 `CODEX_FEISHU_GATEWAY_TOKEN`，不依赖全局 provider-store
- 不调用全局 `openclaw gateway install`

如需启用：

```bash
systemctl --user enable openclaw-codex-feishu.service
systemctl --user start openclaw-codex-feishu.service
```

## 7. 验收顺序

1. `./scripts/bootstrap-codex-feishu.sh preflight`
2. `./scripts/bootstrap-codex-feishu.sh gateway-status`
3. `./scripts/feishu-app-audit.sh`
4. 飞书私聊新 bot，完成 pairing
5. 在 Feishu 会话中执行 `/acp doctor`
6. 验证至少一项文档操作
7. 验证至少一项日历操作
8. 验证至少一项任务操作
9. 验证旧 bot 与新 bot 可以同时工作

## 8. 失败即中止

以下情况必须直接失败，不能带风险继续：

- 误填旧 App ID `cli_a9281a1ee83a1cc8`
- 端口过近旧实例 `18790`
- 任一路径落回 `~/.openclaw`
- 试图覆盖默认 `openclaw-gateway.service`

## 9. 出站消息与识别 bot 的坑

### 9.1 不要直接复用旧 bot 的 open_id

Feishu 的 `open_id` 是 **按应用隔离** 的。

- 旧 bot 下看到的 `ou_xxx`，拿给新 bot 发送时，会返回：
  - `99992361`
  - `open_id cross app`

这不是 OpenClaw 配置问题，而是 Feishu 的 ID 作用域限制。

### 9.2 正确的主动私聊前提

二号应用如果要主动给某个用户发识别消息，目标必须满足其一：

1. **这个二号应用自己拿到的 `open_id`**
   - 最简单办法：让用户先给新 bot 发一条任意消息
2. **租户稳定 `user_id`**
   - 但前提是二号应用对该用户所在部门有通讯录可见范围权限

如果没有通讯录授权，查询用户目录会报：

- `40004`
- `no dept authority error`

### 9.3 建议的操作方式

统一使用仓库 helper，避免误连到旧 gateway：

```bash
./scripts/openclaw-isolated.sh health --json
./scripts/send-feishu-identify.sh --to 'user:<new-app-open-id-or-tenant-user-id>'
```

如果你手里只有旧 bot 的 `open_id`，请不要继续重试；应先让用户主动给新 bot 发消息。

## 10. 使用建议

- 只把这个 bot 当作私聊助手，不要先拉群
- 不要放宽默认私聊/群聊安全策略
- 如果未来必须替换 stock `feishu` 插件，只在这套隔离实例里做，不动现有 `~/.openclaw`
