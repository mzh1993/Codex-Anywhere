# Feishu Codex Runner V1

> Alpha protocol note. Explains current behavior, not a production guarantee.

## 定位

- 核心产品：安全执行核心
- Feishu：第一控制平面
- OpenClaw：当前 Feishu transport shell、pairing、去重、安全壳
- Codex CLI：唯一执行器

V1 不尝试复刻桌面 Codex 会话，只做任务型远程执行。

## 代码入口

- 插件目录：`extensions/codex-bridge`
- 配置模板：`config/openclaw.codex-feishu.json5`
- 渲染后配置位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/openclaw.codex-feishu.json5`

## 状态目录

- Bridge 根目录位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge`
- 用户 profile：`profiles/<sender>.json`
- 任务状态：`tasks/<task>.json`
- 审批 token：`approvals/<token>.json`
- run 记录：`runs/<run>.json`
- run 日志目录：`runs/<run>/`
- 隔离 `CODEX_HOME`：`codex-home/`

## 语言配置

- `plugins.entries."codex-bridge".config.locale` 控制 Runner 对外语言
- 当前支持：
  - `zh-CN`
  - `en-US`
- 该配置同时影响：
  - bridge 自身文案：帮助、状态、审批、错误
  - Codex 执行 prompt：要求最终摘要与建议使用同一语言
- 示例：

```json5
"codex-bridge": {
  enabled: true,
  config: {
    locale: "zh-CN"
  }
}
```

## 执行模型

- 单用户同一时刻仅保留一个活动 task
- 一个 task 可跨多个串行 runs
- 新消息且无活动 task：创建新 task
- 新消息且活动 task 为 `awaiting_input`：自动续到同一 task 的下一次 run
- `/codex continue <prompt>`：仅当活动 task 为 `awaiting_input` 时，创建下一次 run
- 获批后不会恢复旧 run，而是为同一 task 创建新的获批 run
- 新任务默认 `cwd` 取自 bridge 默认工作目录配置
- 若用户先执行 `/codex cwd <path>`，后续任务改用新目录

## 状态协议

- task statuses：`created`、`running`、`awaiting_input`、`awaiting_approval`、`completed`、`aborted`
- run statuses：`running`、`completed`、`failed`、`aborted`、`blocked`
- 普通 run 完成或失败后，task 默认回到 `awaiting_input`
- denied 不会落成 task 终态；默认会记录一次 `blocked` run，并把 task 放回 `awaiting_input`
- approval_required 会结束当前 run，并把 task 置为 `awaiting_approval`

## 风控

### 直接执行

- 当前 `cwd` 内常规代码编辑
- 测试、构建、常规诊断

### 需审批

- 触碰 `~/.codex`
- systemd / `systemctl`
- shell 启动文件
- 全局包环境
- 端口、daemon、明显 destructive 请求

### 直接拒绝

- 触碰 `~/.openclaw`
- 触碰 bridge 自身隔离状态目录
- `openclaw gateway install`
- 其它明显破坏新旧 OpenClaw 隔离边界的请求

## Feishu 命令

```text
/codex cwd <path>
/codex pwd
/codex continue <prompt>
/codex status
/codex abort
/codex approve <token>
/codex help
```

- 普通文本只会在 `awaiting_input` 时自动续任务
- `running` / `awaiting_approval` 时，继续输入必须走显式协议，避免渠道猜测执行语义
- `/codex approve <token>` 对应的是当前 task 的审批点，而不是恢复旧 run

## 当前已知限制

- `codex exec --json` 的事件聚合做的是宽松兼容解析，V1 以开始/心跳/结束回传为主
- 高风险审批仍是文本 token，不依赖卡片
- 非 `/codex` 的 slash 命令不会被 bridge claim
- `plugins.allow` 目前保持为空，因此 OpenClaw 会提示本地非 bundled 插件被显式发现；这不影响运行

## 恢复语义

- 若 bridge 重启后发现持久化里仍有旧的 `running` task，会先把它回收到 `awaiting_input`
- 该 task 会保留为当前活动 task，但会要求一次显式 `/codex continue <prompt>`
- 对用户提示为“上一轮执行中断，请明确继续”
- 当前不根据“长时间无心跳”自动改写 task 状态；无心跳只用于观测，不用于推断执行已死
