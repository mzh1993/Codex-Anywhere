# Codex Anywhere

> A remote bridge for working with Codex from anywhere.

- Start Codex tasks remotely
- Receive task status updates
- Approve sensitive actions when needed

Feishu is the first channel. OpenClaw is the current transport shell.

## 最低基础设施

- Linux 主机的 `/usr/bin/bwrap >= 0.9.0`
- `codex-cli 0.116.0` 是当前验证基线；当前版本会直接调用系统 `/usr/bin/bwrap`
- `bootstrap` / `preflight` 会额外执行一次 `codex sandbox linux -- /bin/true` 实探
- 如果执行环境不满足最低要求，bridge 会在任务启动前直接拒绝，而不是进入假运行态

## 快速开始

```bash
export CODEX_FEISHU_APP_ID='cli_xxx'
export CODEX_FEISHU_APP_SECRET='xxx'
./scripts/install.sh
```

Windows (PowerShell, native):

```powershell
$env:CODEX_FEISHU_APP_ID = "cli_xxx"
$env:CODEX_FEISHU_APP_SECRET = "xxx"
.\scripts\install.ps1
```

Windows 托管策略（默认）：优先 `NSSM` 注册服务；若未安装 `NSSM` 自动回退为“登录触发计划任务”。
安装脚本会写入单一状态文件：`.isolated/codex-feishu/state/install-health.json`。

## 项目定位

这是一个面向 `Codex` 的远程通信桥梁。

- 当前入口：Feishu
- 当前传输壳：OpenClaw
- 当前稳定交互：文本、状态、审批
- 自然语言是主路径；显式启动持续会话时再使用 `/codex ...`
- 当前运行模式：
  - `secure_linux`（默认）：安全优先，审批策略保持严格
  - `native_windows_fast`：体验优先，允许在显式原生命令面下降低审批负担（仍保留审计）
- bridge 只在显式 `/codex ...` 启动面，或自有审批 / 控制面闭环里做最薄 gate；普通文本语义默认仍归 `Codex`
- paired bridge 私聊的 Full Access 现按 DM 级状态记住：一旦显式高权限获批，后续任务默认沿用，直到显式降权或 reset
- 这里的“Full Access”只表示 bridge 会默认按高权限方式启动 `codex exec`；宿主 GPU / systemd / 设备可见性仍取决于当前运行时
- 如需在显式新任务时直接申请 Full Access，使用原生命令面：`/codex --cd <path> --sandbox danger-full-access <prompt>`；如需显式声明不再询问审批策略，也支持 `--ask-for-approval never`
- 若用户表面显示“新会话 / reset 完成”，执行层也必须真地切到新的 task / session lane，而不是只换聊天壳
- 当前 reset 对齐依赖 OpenClaw 官方 `before_reset` 信号来清 lane，不靠 bridge 猜 `/new` / `/reset` 文本
- 在这条 paired bridge 私聊表面，历史顶层 `/new` / `/reset` 已关闭；显式新任务请使用 `/codex --cd ...`，显式续写请使用 `/codex resume ...`
- 历史 `/codex` 兼容命令（如 `help/status/abort/approve/cwd/pwd/continue`）已关闭执行，统一回到最短 native-first 指引

它的职责是把远程输入、状态回传和审批动作接到本机 `codex exec`，而不是扩展成一个通用 IM 平台或重新封装一套新的 Codex 主交互语义。`/codex doctor` 当前用于输出真实运行健康摘要（`Codex CLI`、`bwrap`、隔离 Feishu 凭据、gateway）。手机远程主路径收口为：显式启动持续会话，然后继续用普通文本和 `Codex` 对话。

## `/codex` 速查（可直接复制）

- 默认：直接发送自然语言给 `Codex`
- 新任务：`/codex --cd <path> <prompt>`
- 完全访问：`/codex --cd <path> --sandbox danger-full-access <prompt>`
- 续写：`/codex resume <prompt>`
- 健康检查：`/codex doctor`
- 可选参数：`--model <model>` `--reasoning <level>` `--ask-for-approval <policy>`
- 忘记命令时：发送 `/codex` 或 `/codex help`（两者返回同一份短速查）

## 仓库内容

- `scripts/bootstrap-codex-feishu.sh`：安装隔离运行时、渲染配置、执行预检、启动 gateway
- `scripts/install.sh`：Linux 一键安装入口（bootstrap + preflight + systemd）
- `scripts/install.ps1`：Windows 原生安装入口（`NSSM` 优先，任务计划回退）
- `scripts/openclaw-isolated.sh`：统一连接仓库隔离 gateway 的 OpenClaw CLI 包装脚本
- `scripts/feishu-app-audit.sh`：审计 Feishu 应用发布、事件订阅和可见范围
- `extensions/codex-bridge/`：远程 Codex bridge，负责消息路由、审批、恢复和调用本机 `codex exec`
- `config/openclaw.codex-feishu.json5`：隔离实例配置模板
- `docs/feishu-codex-bridge-v1.md`：当前 V1 bridge 协议与运行边界

## 继续阅读

- `SECURITY_MODEL.md`：安全边界与隔离模型
- `docs/feishu-codex-bridge-v1.md`：当前 Feishu Bridge V1 协议
- `docs/contract-matrix.md`：顶层约束到测试映射的契约矩阵（仅开发治理层）
- `docs/experience-regression-checklist.md`：连续性 / 审批 / 重启恢复 / 长任务观测体验回归清单
- `docs/product-north-star.md`：产品北极星与第一原则
- `docs/product-decision-baseline.md`：内部决策基线
- `docs/roadmap.md`：能力缺口优先级路线图
- `docs/deployment-p1-cross-platform.md`：跨平台部署 P1 契约

## 提交前 + CI 泄露防护

```bash
./scripts/security/install-hooks.sh
./scripts/security/scan-secrets.sh repo
./scripts/security/scan-secrets.sh history
```

- 本地提交前由 `pre-commit` 自动执行 `staged` 扫描
- 本地推送前由 `pre-push` 自动执行 `repo` 扫描
- GitHub Actions 会在 `push/pull_request` 执行 `repo + history` 双层扫描
- 若本次变更涉及行为语义（边界/连续性/可观测性/命令面/跨平台语义），需在同一改动同步更新 `docs/contract-matrix.md`
- CI 会执行 `scripts/review/check-contract-matrix.sh`：当核心行为语义文件改动且未同步更新 `docs/contract-matrix.md` 时会失败
- 体验回归一键入口：`scripts/review/run-experience-regression.sh`
- 体验回归可选全量模式：`RUN_FULL=1 scripts/review/run-experience-regression.sh`（含超时防挂尾）
