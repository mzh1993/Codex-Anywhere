# Codex ↔ Feishu 官方方案调研

调研日期：**2026-03-23**

## 1. 官方插件来源

- GitHub 官方仓库：`https://github.com/larksuite/openclaw-lark`
- 本机克隆快照：
  - 版本：`@larksuite/openclaw-lark@2026.3.17`
  - commit：`67cbd55ee47108e3167f9518429f8f83dbdb5985`
- 本机已安装 OpenClaw 文档：
  - `/home/neousys/.npm-global/lib/node_modules/openclaw/docs/zh-CN/channels/feishu.md`
  - `/home/neousys/.npm-global/lib/node_modules/openclaw/docs/providers/openai.md`

## 2. 官方插件能力面

官方插件不仅能收发 IM，还覆盖：

- 消息：读消息、搜消息、回消息、线程、图片/文件资源
- 文档：创建、读取、更新云文档
- 表格：多维表格、电子表格
- 日历：创建/查询/修改日程、忙闲
- 任务：任务、任务清单、子任务、评论
- 卡片：交互卡片、流式卡片、按钮回调
- OAuth：用户授权、批量授权、撤销授权
- 诊断：`feishu-diagnose` CLI、`/acp doctor` 等命令

本地从源码抽到的工具名包括：

- `feishu_create_doc`
- `feishu_fetch_doc`
- `feishu_update_doc`
- `feishu_sheet`
- `feishu_bitable_*`
- `feishu_calendar_*`
- `feishu_task_*`
- `feishu_chat`
- `feishu_im_user_*`
- `feishu_oauth`
- `feishu_oauth_batch_auth`

## 3. 官方插件运行模型

- Channel ID 固定为 `feishu`
- 官方实现优先走 **WebSocket 长连接**
- 消息去重在进程内完成，但用户 OAuth token 默认写入 `XDG_DATA_HOME/openclaw-feishu-uat`
- 交互卡片回调依赖 `card.action.trigger`
- 插件内置私聊/群聊策略、allowlist、pairing、每群配置、独立技能绑定
- 多账号隔离已有设计，但需要额外的 bindings / session scope 配合

## 4. 本机现状

### 4.1 现有 OpenClaw

- 全局 `openclaw` 版本：`2026.3.13`
- 当前全局状态目录：`/home/neousys/.openclaw`
- 现有 Feishu 配置：
  - App ID：`cli_a9281a1ee83a1cc8`
  - Gateway 端口：`18790`
  - 渠道：`channels.feishu.enabled = true`

### 4.2 现有 Feishu 状态

已存在以下状态，说明当前主实例已经在使用 Feishu：

- `/home/neousys/.openclaw/openclaw.json`
- `/home/neousys/.openclaw/feishu/dedup/default.json`
- `/home/neousys/.openclaw/credentials/feishu-*`

这意味着**不能**复用同一状态目录，也不应复用同一 App/Bot。

### 4.3 Codex 条件

- `codex-cli` 版本：`0.114.0`
- `~/.codex/auth.json` 当前包含 `OPENAI_API_KEY`，但不含可直接复用的 Codex OAuth token

## 5. 架构决策

### 选择

- **独立运行时**
- **独立 Feishu 应用 / 独立 bot**
- **官方 stock `feishu` 插件**
- **`codexzh/gpt-5.4` 作为默认模型**
- **V1 私聊优先，群聊禁用**

### 不选项

- 不复用现有 `~/.openclaw`
- 不复用现有 App ID / App Secret / bot
- 不依赖 `openai-codex` OAuth 作为主模型路径
- 不使用 ACP `codex` 作为主 Feishu 运行模式
- 不在已内置 `feishu` 的 OpenClaw 实例里再侧载 `@larksuite/openclaw-lark`

## 6. 冲突面分析

必须隔离以下资源：

- `OPENCLAW_HOME`
- `OPENCLAW_STATE_DIR`
- `OPENCLAW_CONFIG_PATH`
- `XDG_CONFIG_HOME`
- `XDG_CACHE_HOME`
- `XDG_DATA_HOME`
- `agents.defaults.workspace`
- `gateway.port`
- systemd user unit 名称

如果共享，会出现：

- 配置文件竞争
- OAuth token 混用
- Feishu dedup / pairing 状态串用
- gateway 端口冲突
- service 覆盖或误重启现有实例

## 7. 本仓库的实现映射

本仓库落地以下文件：

- `scripts/bootstrap-codex-feishu.sh`
  - 本地安装固定 `openclaw@2026.3.22`
  - 执行 fail-closed 预检
  - 渲染隔离配置
  - 写入隔离 secrets env 文件，供 gateway 前台运行与 systemd 共用
  - 生成独立 systemd user unit
- `config/openclaw.codex-feishu.json5`
  - 固定：
    - `dmPolicy: "pairing"`
    - `groupPolicy: "disabled"`
    - `connectionMode: "websocket"`
    - `streaming: true`
    - `codexzh/gpt-5.4`
- `README.md`
  - 快速启动命令

## 8. 验收建议

上线前至少验证：

1. `preflight` 通过，且路径全部落在仓库隔离目录
2. 新实例 `gateway status` 不再读取 `/home/neousys/.openclaw`
3. 新 bot 私聊配对成功
4. `/feishu doctor` 正常
5. 文档 / 日历 / 任务能力至少各验证一次
6. 旧 bot 与新 bot 可并行工作
7. systemd 启动时只读取本仓库隔离 env / secrets，不依赖 shell 临时环境

## 9. 本机新增验证结论（2026-03-23 晚）

- 隔离 CLI 直连时，客户端要显式使用：
  - `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:19789`
  - `OPENCLAW_GATEWAY_TOKEN=<isolated token>`
- 因此仓库新增了：
  - `scripts/openclaw-isolated.sh`
  - `scripts/send-feishu-identify.sh`

### 9.1 新 bot 主动识别消息失败的真实原因

对 `ou_a9e075bb5f1ad13fbfba045ed5dc8632` 发起一次隔离 cron announce 后，实际运行结果为：

- cron run 状态：`error`
- Feishu 返回：`99992361 open_id cross app`

结论：

- 旧 bot 的 `open_id` 不能拿给新 bot 直接发送
- 这是 Feishu 的 app-scoped ID 机制，不是 OpenClaw 路由问题

### 9.2 为什么没法直接反查 tenant user_id

尝试用新 app 的通讯录 API 反查用户时，返回：

- `40004 no dept authority error`

结论：

- 当前二号应用尚无足够的通讯录可见范围
- 所以无法仅靠用户名在新 app 下反查 `user_id`

### 9.3 当前最稳妥的识别路径

1. 让用户先主动给新 bot 发一条消息
2. 新 bot 一旦收到，就会拿到**属于这个新 app 的 open_id**
3. 后续再做主动消息、定时消息、识别消息都不会再遇到 `open_id cross app`
