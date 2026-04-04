# Codex Anywhere

> 随时随地，从 Feishu 远程驱动你自己的 Codex 执行环境（不仅限于开发任务）。

<p align="center">
  <img src="imgs/codex_anywhere.gif" alt="Codex Anywhere demo" width="100%" />
</p>

<p align="center">
  <a href="docs/deployment-p1-cross-platform.md">部署文档</a> ·
  <a href="SECURITY_MODEL.md">安全模型</a> ·
  <a href="docs/feishu-codex-bridge-v1.md">Bridge 协议</a>
</p>

## 是什么

`Codex Anywhere` 把三件事连成一条闭环：

1. 你在 Feishu 里用自然语言发起任务。  
2. `Codex Bridge` 把消息路由到本机 `codex exec`。  
3. 状态、结果和审批请求再回到 Feishu。  

这让你可以在手机、平板、另一台电脑上，持续操控自己的主机环境。

## 核心能力

- 远程发起任务：消息直接映射为 `codex exec` 工作流  
- 状态持续回传：运行中、完成、失败、等待审批均可追踪  
- 审批可控：敏感动作可走显式确认  
- 跨平台部署：Linux 与 Windows 都有可落地安装路径  
- 隔离执行：结合 OpenClaw + runtime 策略约束执行边界  

## 最低基础设施

- Linux 主机的 `/usr/bin/bwrap >= 0.9.0`
- `codex-cli 0.116.0` 是当前验证基线；当前版本会直接调用系统 `/usr/bin/bwrap`
- `bootstrap` / `preflight` 会额外执行一次 `codex sandbox linux -- /bin/true` 实探
- 如果执行环境不满足最低要求，bridge 会在任务启动前直接拒绝，而不是进入假运行态

## 快速开始

Linux:

```bash
export CODEX_FEISHU_APP_ID='cli_xxx'
export CODEX_FEISHU_APP_SECRET='xxx'
./scripts/install.sh
```

Windows (PowerShell):

```powershell
$env:CODEX_FEISHU_APP_ID = "cli_xxx"
$env:CODEX_FEISHU_APP_SECRET = "xxx"
.\scripts\install.ps1
```

安装健康状态文件：

`./.isolated/codex-feishu/state/install-health.json`

## 安装后 60 秒自检

1. 在 Feishu 私聊机器人发送：`/codex doctor`
2. 再发送一条普通文本（例如：`你好`）
3. 最后发送一条显式命令（例如：`/codex --cd C:\codex\Codex-Anywhere 帮我看 README`）

如果三步都得到预期响应，说明消息链路和执行链路都已通。

## 当前执行语义

- 自然语言是主路径；只有显式启动或续写持续会话时才使用 `/codex ...`
- bridge 只在显式 `/codex ...` 启动面，或自有审批 / 控制面闭环里做最薄 gate；普通文本语义默认仍归 `Codex`
- paired bridge 私聊的 Full Access 按 DM 级状态记住：显式高权限获批后，后续任务默认沿用，直到显式降权或 reset
- 显式申请 Full Access：`/codex --cd <path> --sandbox danger-full-access <prompt>`
- 显式降回普通默认权限：下一次显式 `/codex` 启动或续写时带 `--sandbox workspace-write`
- `--ask-for-approval never` 只影响审批策略，不等于 Full Access，也不替代 `--sandbox` 的选择

## 常用命令

- 新任务：`/codex --cd <path> <prompt>`
- 继续当前任务：`/codex resume <prompt>`
- 健康检查：`/codex doctor`
- 显式全权限（按需使用）：`/codex --cd <path> --sandbox danger-full-access <prompt>`

## 排障最短路径

1. 先看 Feishu 侧：`/codex doctor`
2. 再看安装状态：`./.isolated/codex-feishu/state/install-health.json`
3. 再看运行日志：`%LOCALAPPDATA%\Temp\openclaw\openclaw-YYYY-MM-DD.log`

Windows 常见噪声（非阻断）：

- `plugins.allow is empty`
- `no im.chat.access_event.bot_p2p_chat_entered_v1 handle`
- 启动阶段短暂 `unresolved SecretRef ... CODEX_FEISHU_APP_SECRET`（若后续 `ws client ready` 正常出现，通常可忽略）

## 文档索引

- 跨平台部署：`docs/deployment-p1-cross-platform.md`
- 安全与隔离：`SECURITY_MODEL.md`
- Feishu Bridge 协议：`docs/feishu-codex-bridge-v1.md`
- 体验回归清单：`docs/experience-regression-checklist.md`

## 设计源文件

README 头图的可编辑版本在：

- `imgs/codex_anywhere.html`（HTML 动图模板）
- `imgs/codex_anywhere.gif`（README 当前展示动图）
