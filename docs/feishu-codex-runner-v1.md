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
- 对普通宿主路径的只读检查、阅读、总结

### 需审批

- 触碰 `~/.codex`
- `cwd` 外普通宿主路径写入
- systemd / `systemctl`
- 全局包环境变更
- 明显 destructive 请求

### 直接拒绝

- 触碰 `~/.openclaw`
- 触碰 bridge 自身隔离状态目录
- `openclaw gateway install`
- 其它明显破坏新旧 OpenClaw 隔离边界的请求

## 最小策略矩阵

> V1 当前以任务 `cwd` 作为受控工作根；这是一条执行边界，不是渠道约定。

| 动作类型 | 目标区域 | 结果 | 说明 |
| --- | --- | --- | --- |
| 读/查看/总结 | `cwd` 内普通文件 | 允许 | 常规仓库阅读、诊断、总结。 |
| 写/改/建/追加 | `cwd` 内普通文件 | 允许 | 当前受控工作根内的常规改动。 |
| 读/查看/总结 | `cwd` 外普通宿主路径 | 允许 | V1 允许只读检查，但不因此放宽写入边界。 |
| 写/改/建/移动/重命名 | `cwd` 外普通宿主路径 | 审批 | 当前按“离开受控根”的宿主变更处理。 |
| 任意动作 | `~/.codex` | 审批 | 属于宿主 Codex 状态边界。 |
| 任意动作 | `~/.openclaw` | 拒绝 | 属于宿主 OpenClaw 边界，不允许任务触碰。 |
| 任意动作 | bridge 隔离状态目录 | 拒绝 | 不允许任务回写自身运行状态。 |
| 服务控制 | `systemctl` / `.service` | 审批 | 视为系统级控制动作。 |
| 全局环境变更 | 全局安装 / 用户级安装 | 审批 | 如 `npm -g`、`pnpm add -g`、`pip --user`、`apt install`。 |
| 明显破坏性动作 | 如 `rm -rf` | 审批 | 当前不直接放行。 |

## 当前策略解释

- 当前最小模型不是“枚举所有敏感目录”，而是“先定义受控工作根，再看动作是否越界”。
- 当前 `cwd` 内默认允许常规工作，是因为它被视为当前 task 的受控执行范围。
- 当前 `cwd` 外写入默认进入审批，是因为它意味着任务开始触碰宿主其它区域。
- 当前 `~/.openclaw` 与 bridge 隔离状态目录直接拒绝，是因为它们会破坏运行边界本身。
- 当前对 `move / rename / copy` 等词已做最小去歧义：讨论计划不等于执行动作。

## 边界回归测试命名

- 当前回归测试文件：`extensions/codex-bridge/test/policy.test.js`
- 当前命名前缀格式：`<decision>/<action>/<zone>: <case>`
- 当前 `decision` 取值：
  - `allow`
  - `approval`
  - `deny`
- 当前 `action` 取值示例：
  - `read`
  - `write`
  - `control`
  - `install`
  - `destructive`
  - `any`
- 当前 `zone` 取值示例：
  - `inside_cwd`
  - `outside_cwd`
  - `protected_root`
  - `host_codex_root`
  - `service`
  - `global_env`
  - `discussion`
- 当前约定：每补一条策略矩阵，都应至少补一条同语义前缀的回归测试。

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

## 输入协议矩阵

### `no_task`

- 普通文本：允许，创建新 task
- `/codex continue <prompt>`：拒绝，当前没有可继续任务
- `/codex approve <token>`：拒绝，当前没有待审批任务
- `/codex abort`：拒绝，当前没有活动任务
- `/codex status`：允许，只查询当前状态
- `/codex cwd <path>`、`/codex pwd`：允许

### `awaiting_input`

- 普通文本：允许，续到同一 task 的下一次 run
- 若该 task 带“上一轮执行中断，请明确继续”语义：普通文本拒绝，必须使用 `/codex continue <prompt>`
- `/codex continue <prompt>`：允许，显式续到同一 task
- `/codex approve <token>`：拒绝，当前不在审批态
- `/codex abort`：允许，终止整个 task
- `/codex status`：允许，只查询当前状态
- `/codex cwd <path>`、`/codex pwd`：允许

### `running`

- 普通文本：拒绝，不能插队，不得隐式继续
- `/codex continue <prompt>`：拒绝，当前不在等待输入
- `/codex approve <token>`：拒绝，当前不在审批态
- `/codex abort`：允许，终止整个 task
- `/codex status`：允许，只查询当前状态
- `/codex pwd`：允许
- `/codex cwd <path>`：允许修改未来默认值，但不影响当前 running task

### `awaiting_approval`

- 普通文本：拒绝，不能当普通任务执行
- `/codex continue <prompt>`：拒绝，当前不在等待输入
- `/codex approve <token>`：允许，为同一 task 创建新的获批 run
- `/codex abort`：允许，终止整个 task
- `/codex status`：允许，只查询当前状态
- `/codex pwd`：允许
- `/codex cwd <path>`：允许修改未来默认值，但不影响当前待审批 task

## 关键规则

- `/codex status` 在所有状态下都合法，但只负责查询，不推进状态
- `/codex continue <prompt>` 只在 `awaiting_input` 合法
- `/codex approve <token>` 只在 `awaiting_approval` 合法
- `/codex abort` 在 `awaiting_input`、`running`、`awaiting_approval` 下都表示终止整个 task
- `/codex cwd <path>` 只修改未来默认工作目录，不热切换当前活动 task
- 默认采用严格状态机：宁可多拒绝一次，也不让渠道猜测执行语义

## 状态机回归测试命名

- 当前状态机回归测试文件：
  - `extensions/codex-bridge/test/routing.test.js`
  - `extensions/codex-bridge/test/task-model.test.js`
- 当前命名前缀格式：`protocol/<topic>/<scope>: <case>`
- 当前 `topic` 取值示例：
  - `input`
  - `command`
  - `transition`
  - `status`
  - `execution`
  - `persistence`
  - `locale`
  - `recovery`
- 当前约定：新增输入协议、状态流转、恢复语义时，优先补同前缀的回归测试。

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
