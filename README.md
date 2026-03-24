# Codex Anywhere

> A remote bridge for working with Codex from anywhere.

- Start a task remotely
- Receive status updates
- Approve sensitive actions

Feishu is the first channel. OpenClaw is the current transport shell.

## 最低基础设施

- Linux 主机的 `/usr/bin/bwrap >= 0.9.0`
- `codex-cli 0.116.0` 是当前验证基线；当前版本会直接调用系统 `/usr/bin/bwrap`
- `bootstrap` / `preflight` 会额外执行一次 `codex sandbox linux -- /bin/true` 实探
- 如果执行环境不满足最低要求，runner 会在任务启动前直接拒绝，而不是进入假运行态

## 快速开始

```bash
export CODEX_FEISHU_APP_ID='cli_xxx'
export CODEX_FEISHU_APP_SECRET='xxx'
./scripts/bootstrap-codex-feishu.sh bootstrap
./scripts/bootstrap-codex-feishu.sh persist-secrets
./scripts/bootstrap-codex-feishu.sh gateway-run
```

## 项目定位

这是一个面向 `Codex` 的远程通信桥梁。

- 当前入口：Feishu
- 当前传输壳：OpenClaw
- 当前稳定交互：文本、状态、审批

它的职责是把远程输入、状态回传和审批动作接到本机 `codex exec`，而不是扩展成一个通用 IM 平台。

## 仓库内容

- `scripts/bootstrap-codex-feishu.sh`：安装隔离版 `openclaw@2026.3.22`、渲染配置、执行预检、生成 systemd user unit
- `scripts/openclaw-isolated.sh`：强制连接隔离 gateway（自动映射 `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN`）
- `scripts/send-feishu-identify.sh`：向指定 Feishu 目标发一次“这是新 bot”的识别消息，并在失败时给出明确原因
- `scripts/feishu-app-audit.sh`：审计飞书应用的线上发布事件、回调方式与可见范围
- `extensions/codex-bridge/`：Feishu 远程 Codex Runner 插件，负责 claim 已配对私聊消息并调用本机 `codex exec`
- `config/openclaw.codex-feishu.json5`：隔离实例配置模板
- `docs/feishu-codex-runner-v1.md`：Codex Runner V1 的消息协议、状态目录与风控边界

## 常用命令

```bash
./scripts/bootstrap-codex-feishu.sh preflight
./scripts/bootstrap-codex-feishu.sh render-config
./scripts/bootstrap-codex-feishu.sh gateway-status
./scripts/bootstrap-codex-feishu.sh persist-secrets
./scripts/bootstrap-codex-feishu.sh install-systemd
./scripts/bootstrap-codex-feishu.sh print-env
./scripts/openclaw-isolated.sh health --json
./scripts/send-feishu-identify.sh --to 'user:ou_xxx'
./scripts/feishu-app-audit.sh
```

## 隔离 CLI 用法

如果你需要直接调用 OpenClaw CLI，请不要手写 `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN`。

统一走：

```bash
./scripts/openclaw-isolated.sh health --json
./scripts/openclaw-isolated.sh cron list --json
./scripts/openclaw-isolated.sh cron runs --id <job-id>
```

## Feishu 识别消息注意事项

- `/feishu doctor` 不是这里的官方文本命令；当前应使用 `/acp doctor`
- Feishu `open_id` 是 **app-scoped**
- 如果把旧 bot 的 `open_id` 拿给新 bot 发消息，会报 `open_id cross app`
- 如果 bot 私聊完全没反应，先跑 `./scripts/feishu-app-audit.sh`
- 二号应用想主动私聊用户，必须满足其一：
  - 目标是**这个二号应用自己拿到的** `open_id`
  - 目标是租户稳定 `user_id`，且二号应用有通讯录可见范围权限

## 当前排障结论

- 新 bot 长连已成功启动，问题不在隔离 OpenClaw 运行时
- 当前飞书线上版本存在两个阻断项：
  - 已发布版本 `events` 为空，未发布 `im.message.receive_v1` / `card.action.trigger`
  - 已发布版本可见范围只包含应用创建者
- 在这两个条件修正前，普通用户给新 bot 发消息不会进入 OpenClaw

## 重要约束

- 只使用隔离运行时自带的 stock `feishu` 插件
- 新建独立 Feishu 应用与 bot，禁止复用现有 `~/.openclaw` 的 App ID / App Secret
- 默认只开私聊，群聊策略固定为禁用

## 用 `superpowers` 协作开发

- `superpowers` 适合在这个仓库里做需求澄清、计划拆解、代码审查与验收
- 不要把它接入运行时，不要让它进入 Feishu / OpenClaw / bridge 执行链路
- 默认推荐技能：`brainstorming`、`writing-plans`、`requesting-code-review`、`verification-before-completion`
- 默认不推荐：`subagent-driven-development`、`dispatching-parallel-agents`、`using-git-worktrees`

## 社区协作

- 贡献方式见 `CONTRIBUTING.md`
- 安全问题上报见 `SECURITY.md`
- GitHub About 文案与 topics 建议见 `.github/repository-metadata.md`
- 对外发布前，请把 `.github/repository-metadata.md` 的内容同步到 GitHub 仓库设置页

## Codex Runner V1

- 核心产品：安全执行核心，不是单纯的 OpenClaw 插件
- 当前 Feishu 集成：OpenClaw transport shell，可替换
- 最小稳定输出：文本、状态、审批
- 单用户同一时刻只保留一个活动 task；一个 task 可跨多个串行 runs
- 新增 `codex-bridge` 本地 OpenClaw 插件，claim 已配对 Feishu 私聊业务消息
- OpenClaw 仅做 Feishu transport / pairing / 安全壳；实际执行器改为本机 `codex exec`
- Runner 状态目录位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge`
- Runner 使用独立 `CODEX_HOME`，例如：`$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge/codex-home`
- 默认会从 `$HOME/.codex/auth.json` 和 `$HOME/.codex/config.toml` 复制认证/模型配置到隔离 `CODEX_HOME`

### Feishu 命令

```text
/codex cwd <path>
/codex pwd
/codex continue <prompt>
/codex status
/codex abort
/codex approve <token>
/codex help
```

- 非 `/codex` 的普通私聊文本默认视为一个新任务
- 若当前活动 task 处于 `awaiting_input`，普通私聊文本会自动续到同一 task 的下一次 run
- `/codex continue <prompt>` 只在当前 task 处于 `awaiting_input` 时创建下一次 run
- `/acp ...` 等 OpenClaw 管理命令保持原路径，不走 Codex bridge
- 高风险任务会先阻塞当前 run 并返回一次性 token，必须 `/codex approve <token>` 才会创建获批后的下一次 run

## Feishu 应用配置

- 事件订阅：`im.message.receive_v1` 和 `card.action.trigger`
- 其它发布与权限细节请直接在 Feishu 开发者后台配置

## systemd 说明

- `install-systemd` 会要求存在隔离 secrets env 文件
- secrets 文件除 Feishu / 模型密钥外，还会自动持久化独立的 `CODEX_FEISHU_GATEWAY_TOKEN`
- secrets 文件默认位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/openclaw-codex-feishu.secrets.env`
- 生成的 unit 只服务于本仓库隔离实例，不会调用全局 `openclaw gateway install`

## 公开阅读顺序

- 先看 `README.md`
- 再看 `SECURITY_MODEL.md`
- 然后看 `ROADMAP.md`
- 最后看 `docs/feishu-codex-runner-v1.md`
