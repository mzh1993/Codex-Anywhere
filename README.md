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
- 如果执行环境不满足最低要求，runner 会在任务启动前直接拒绝，而不是进入假运行态

## 快速开始

```bash
export CODEX_FEISHU_APP_ID='cli_xxx'
export CODEX_FEISHU_APP_SECRET='xxx'
./scripts/bootstrap-codex-feishu.sh bootstrap
./scripts/bootstrap-codex-feishu.sh persist-secrets
./scripts/bootstrap-codex-feishu.sh preflight
./scripts/bootstrap-codex-feishu.sh gateway-run
```

## 项目定位

这是一个面向 `Codex` 的远程通信桥梁。

- 当前入口：Feishu
- 当前传输壳：OpenClaw
- 当前稳定交互：文本、状态、审批
- 自然语言是主路径；`/codex ...` 只是兜底控制面

它的职责是把远程输入、状态回传和审批动作接到本机 `codex exec`，而不是扩展成一个通用 IM 平台或重新封装一套新的 Codex 主交互语义。

## 仓库内容

- `scripts/bootstrap-codex-feishu.sh`：安装隔离运行时、渲染配置、执行预检、启动 gateway
- `scripts/openclaw-isolated.sh`：统一连接仓库隔离 gateway 的 OpenClaw CLI 包装脚本
- `scripts/feishu-app-audit.sh`：审计 Feishu 应用发布、事件订阅和可见范围
- `extensions/codex-bridge/`：远程 Codex bridge，负责消息路由、审批、恢复和调用本机 `codex exec`
- `config/openclaw.codex-feishu.json5`：隔离实例配置模板
- `docs/feishu-codex-runner-v1.md`：当前 V1 协议与运行边界

## 继续阅读

- `SECURITY_MODEL.md`：安全边界与隔离模型
- `docs/feishu-codex-runner-v1.md`：当前 Feishu Runner V1 协议
- `docs/product-north-star.md`：产品北极星与第一原则
- `docs/product-decision-baseline.md`：内部决策基线
- `docs/roadmap.md`：能力缺口优先级路线图
