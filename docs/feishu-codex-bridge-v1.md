# Feishu Codex Bridge V1

> Current V1 protocol reference. This file records the current Feishu bridge behavior, not product vision.

## 定位

- Feishu：当前输入 / 输出渠道
- OpenClaw：当前 transport shell、pairing、去重、安全壳
- `codex-bridge`：当前任务路由、审批、恢复、状态持久化实现
- Codex CLI：唯一任务执行器

V1 当前默认以自然语言作为主交互；显式 `/codex` 只在需要控制时出现，并优先贴近原生 `Codex CLI`。

## 代码入口

- 插件目录：`extensions/codex-bridge`
- 配置模板：`config/openclaw.codex-feishu.json5`
- 渲染后配置位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/openclaw.codex-feishu.json5`

## 状态目录

- Bridge 根目录位于仓库隔离状态目录，例如：`$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge`
- 用户 profile：`profiles/<sender>.json`
- 任务状态：`tasks/<task>.json`
- bridge 控制面动作：`bridge-actions/<action>.json`（含最小 `contract` / `trace`）
- 审批 token：`approvals/<token>.json`（含 `replyContract` / `onDeny` / `approvalGrant`）
- run 记录：`runs/<run>.json`
- run 日志目录：`runs/<run>/`
- 隔离 `CODEX_HOME`：`codex-home/`

## 语言配置

- `plugins.entries."codex-bridge".config.locale` 控制 bridge 对外语言
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

## 运行模式配置

- `plugins.entries."codex-bridge".config.runtimeMode` 控制显式 `/codex` 启动面的风险门策略
- 当前支持：
  - `secure_linux`（默认）：保留 safety-first，`approval_required` 仍进入审批
  - `native_windows_fast`：体验优先，把可审批项从 `approval_required` 降为 `allowed`
- 约束：
  - 仅影响“可审批项”；`denied` 仍保持拒绝
  - 不改变普通自然语言 lane 归属（普通文本仍直接给 Codex）
  - 不移除审计与状态持久化（task/run/approval 记录仍保留）
- 示例：

```json5
"codex-bridge": {
  enabled: true,
  config: {
    runtimeMode: "native_windows_fast"
  }
}
```

## 执行模型

- 单用户同一时刻仅保留一个活动 task
- 同一私聊内可临时存在一个独立的 `bridge action`
- 一个 task 可跨多个串行 runs
- 新消息且无活动 task：创建新 task
- 新消息且活动 task 为 `awaiting_input`：默认续到同一 task 的下一次 run
- 若该 task 来自“上一轮执行中断”的恢复态，普通文本仍是默认续写路径
- 若 bridge / gateway 重启打断了当前执行，默认只中断当前 run，不中断 task continuity；恢复后下一条普通文本仍默认续到同一 task
- 长任务执行中默认维持同一张运行卡；若暂无新的可见状态，bridge 仍会在有界时间内刷新该卡，避免用户失去“任务仍在继续”的观测感
- 显式续写沿用原生命名 `resume`：`/codex resume [--model <model>] [--reasoning <level>] <prompt>`
- 原生 `codex resume` 已支持 session id / thread name / `--last` 等选择模式；bridge 主路径明确只保留 prompt 续写，不纳入选择面；task 激活后普通文本仍是默认续写路径
- 获批后不会恢复旧 run，而是为同一 task 创建新的获批 run
- 仓库自有控制面请求（如 `openclaw-codex-feishu.service`、gateway 健康检查）优先进入独立的 `bridge action`，不占用 task continuity
- 仓库自有 service control 由 bridge 固定 handler 执行；当前仓库实例的 service unit 走 `systemctl --user`
- 纯 repo-owned control-plane 按风险治理：只读查询可直接执行，变更类动作先审批后执行；当前 V1 对应为 `status / health / diagnostic` 直执，`service control / install lifecycle` 审批
- 新任务默认 `cwd` 取自 bridge 默认工作目录配置
- 显式新任务优先贴近原生：`/codex --cd <path> [--model <model>] [--reasoning <level>] <prompt>`
- paired bridge 私聊当前额外持久化一个 DM-scoped `accessMode`：`normal | full_access`
- 当用户在当前 DM 内显式批准高风险 `codex task` 后，该 DM 会记住 `full_access`；后续新任务 / 续写默认继承高权限，直到显式降权或 reset
- 这里的 `full_access` 只表达“默认以高权限方式启动 Codex”；不单独保证宿主 GPU、systemd user bus 或其它设备能力一定可见
- 若对用户表面宣称“已新开会话 / 已 reset 完成”，执行层必须对应新的 task / session lane；不能只重置聊天壳而继续复用旧执行 lane
- 当前 reset 对齐依赖 OpenClaw 官方 `before_reset` 信号来清理 bridge continuity；不靠 bridge 猜 `/new` / `/reset` 文本
- 在 paired bridge 私聊表面，历史顶层 `/new` / `/reset` 已关闭，不再作为会话切换入口；显式新任务只走 `/codex --cd ...`，显式续写只走 `/codex resume ...`

## 状态协议

- task statuses：`created`、`running`、`awaiting_input`、`awaiting_approval`、`completed`、`aborted`
- run statuses：`running`、`completed`、`failed`、`aborted`、`blocked`
- bridge action statuses：`created`、`awaiting_approval`、`running`、`finished`
- bridge action result statuses：`completed`、`failed`、`denied`
- `bridge action` 的生命周期终态统一是 `finished`；成功、失败、拒绝由 `resultStatus` 区分
- `bridge action.contract` 当前固定为：`kind / operation / target / executor`
- `bridge action.trace` 当前固定为：
  - `execution`：`executor / command / args / exitCode`
  - `recovery`：`reason`
- bridge 内部维护一个不对用户暴露的 reply owner：
  - `owner=codex`：普通文本直接归 Codex 会话语义
  - `owner=bridge_approval`：下一条普通文本仅在当前审批闭环里先归 bridge 审批语义
  - `owner=bridge_action`：当前由 bridge 自己拥有控制面动作闭环
- profile 当前还持久化最薄权限状态：`accessMode=normal|full_access`
- 普通 run 完成或失败后，task 默认回到 `awaiting_input`
- denied 不会落成 task 终态；默认会记录一次 `blocked` run，并把 task 放回 `awaiting_input`
- approval_required 会结束当前 run，并把 task 置为 `awaiting_approval`
- `bridge action` 完成后只产出最小结果，不写入 task 的 `summary / changedFiles / nextSteps / sessionId`

## Reply Plane

- 当前 V1 已落地 same-origin reply plane：最终摘要与 `Codex` 显式声明的最终可消费产物，会默认回到发起该 task 的同一 Feishu 会话 / 线程
- bridge 只执行最薄 reply-plane 规则，不拥有任务解释权：它不会扫描工作区、目录 diff 或语义猜测来补产物
- 当前回传只接受 `Codex` 末尾 `Delivery Manifest` 里显式声明的内容：
  - 必填 `summary`
  - 可选 `deliverables`
  - 可选 `note`
- 当前 `deliverables` 只接受：
  - 本地 `file / image / audio / video`
  - 外部 `link`
- 本地产物路径当前只允许相对 `cwd`；绝对路径、`..` 越界、缺失文件、类型不匹配、越界软链接都会 fail closed
- 若用户显式只要一个主产物，默认只回这个主产物；伴随说明件默认留在 `summary`，除非用户明确要求一起回传
- 若某个产物声明非法或上传失败：
  - `summary` 仍照常返回
  - 合法产物仍照常返回
  - 失败产物只在完成卡里附一条极短聚合提示
- 完成卡当前只承担结果锚点，不承担原生产物展示：
  - 不展示产物数量
  - 不重复展开产物描述
  - 原生产物已回传时，不再附原始 changed-files 清单
  - 不保留会被 Feishu 渲染成重复媒体的 markdown 内联图片
- 完成卡只做固定预算整形：保 `summary`、保最小 `next step`，不做语义裁剪。
- 成功产物当前通过原生 Feishu 消息回到同一 origin；`.svg` 这类向量图会降级为文件回传，而不是按图片渲染
- 当前 Phase 1 只支持 same-origin 默认闭环；显式跨 origin 改投仍不属于 V1 主路径

## 风控

### 直接执行

- 当前 `cwd` 内常规代码编辑
- 测试、构建、常规诊断
- 对普通宿主路径的只读检查、阅读、总结

### 需审批

- 触碰 `~/.codex`
- `cwd` 外普通宿主路径写入
- systemd / `systemctl`
- 计划任务控制（如 `crontab`、`at`、带定时参数的 `systemd-run`、`.timer`）
- 长期运行进程控制或托管启动（如 `nohup`、`pm2`、`uvicorn`、`npx http-server`、显式后台化 `&`）
- 远端执行或外发传输（如 `ssh`、`scp`、远端 `rsync`、`curl -T`）
- 容器或编排执行平面控制（如 `docker`、`podman`、`kubectl`、`helm`）
- 对外发布到仓库/注册表/Release 通道（如 `git push`、`npm publish`、`twine upload`、`gh release create`）
- 全局包环境变更
- 明显 destructive 请求

当前最小 typed 审批原因码：

- `host_codex_boundary_requires_approval`：触碰宿主 `~/.codex` 边界
- `protected_root_requires_approval`：进入受保护的宿主机边界（如 `~/.openclaw`）
- `outside_cwd_write_requires_approval`：写入当前受控工作目录之外的宿主路径
- `install_lifecycle_requires_approval`：修改 bridge 自有 install lifecycle
- `service_control_requires_approval`
- `scheduler_control_requires_approval`
- `process_control_requires_approval`
- `remote_boundary_requires_approval`
- `container_control_requires_approval`
- `publication_boundary_requires_approval`
- `global_env_change_requires_approval`
- `destructive_change_requires_approval`

### 直接拒绝

- 触碰 bridge 自身隔离状态目录
- 触碰宿主凭证/秘密材料（如 `~/.ssh`、`~/.aws`、`~/.kube`、`~/.gnupg`）
- 直接提权或切换用户（如 `sudo`、`su`、`doas`）
- 显式要求绕过策略/审批/沙箱
- `openclaw gateway install`
- 其它明显破坏新旧 OpenClaw 隔离边界的请求

## 最小策略矩阵

> V1 当前以任务 `cwd` 作为受控工作根；这是一条执行边界，不是渠道约定。

| 动作类型 | 目标区域 | 结果 | 说明 |
| --- | --- | --- | --- |
| 读/查看/总结 | `cwd` 内普通文件 | 允许 | 常规仓库阅读、诊断、总结。 |
| 写/改/建/追加/权限调整 | `cwd` 内普通文件 | 允许 | 当前受控工作根内的常规改动。 |
| 读/查看/总结 | `cwd` 外普通宿主路径 | 允许 | V1 允许只读检查，但不因此放宽写入边界。 |
| 写/改/建/移动/重命名/权限调整 | `cwd` 外普通宿主路径 | 审批 | 当前按“离开受控根”的宿主变更处理。 |
| 任意动作 | `~/.codex` | 审批 | 属于宿主 Codex 状态边界。 |
| 任意动作 | `~/.openclaw` | 审批 | 属于受保护的宿主边界；这里的“审批”仅指显式 bridge 执行入口下、真正启动前的最薄 gate，不意味着 bridge 接管普通发给 Codex 的内容语义。 |
| 任意动作 | bridge 隔离状态目录 | 拒绝 | 不允许任务回写自身运行状态。 |
| 任意动作 | 宿主凭证 / 秘密材料 | 拒绝 | 如 `~/.ssh`、`~/.aws`、`~/.kube`、`~/.gnupg`。 |
| 直接提权 / 切换用户 | 宿主管理员边界 | 拒绝 | 如 `sudo`、`su`、`doas`。 |
| 策略绕过意图 | 审批 / 沙箱 / 策略边界 | 拒绝 | 如 `ignore policy`、`disable sandbox`。 |
| 服务控制 | `systemctl` / `service` / `rc-service` / `initctl` / `.service`（含明显 unit 名变体） | 审批 | 视为系统级控制动作，避免服务名笔误或不同 init 命令绕过审批。 |
| 计划任务控制 | `crontab` / `at` / 定时 `systemd-run` / `.timer` | 审批 | 视为调度执行平面控制动作。 |
| 进程控制 | `nohup` / `pm2` / `supervisorctl` / `uvicorn` / `npx http-server` / 显式后台化 `&` 等 | 审批 | 视为长期运行进程控制动作。 |
| 远端执行 / 外发传输 | 远端主机或外部端点 | 审批 | 如 `ssh`、`scp`、远端 `rsync`、`curl -T`。 |
| 容器 / 编排控制 | 容器引擎或编排平面 | 审批 | 如 `docker`、`podman`、`kubectl`、`helm`。 |
| 对外发布 / 发布通道变更 | 仓库、包仓库或 Release 通道 | 审批 | 如 `git push`、`npm publish`、`twine upload`、`gh release create`。 |
| 全局环境变更 | 全局安装 / 用户级安装 | 审批 | 如 `npm -g`、`pnpm add -g`、`pip --user`、`apt install`。 |
| 明显破坏性动作 | 如 `rm -rf` | 审批 | 当前不直接放行。 |

## 当前策略解释

- 当前最小模型不是“枚举所有敏感目录”，而是“先定义受控工作根，再看动作是否越界”。
- 当前 `cwd` 内默认允许常规工作，是因为它被视为当前 task 的受控执行范围。
- 当前 `cwd` 外写入默认进入审批，是因为它意味着任务开始触碰宿主其它区域；当前内部 reason code 已收口为 `outside_cwd_write_requires_approval`。
- 当前 `~/.codex` 访问默认进入审批，是因为它触碰宿主 Codex 状态边界；这里的“审批”同样只限定为显式 bridge 执行入口下、真正启动前的最薄 gate，不意味着 bridge 接管普通发给 Codex 的内容语义；当前内部 reason code 已收口为 `host_codex_boundary_requires_approval`。
- 当前 `~/.openclaw` 默认进入审批，是因为它属于受保护的宿主边界；这里的“审批”仅限定为显式 bridge 执行入口下、真正启动前的最薄 gate，当前内部 reason code 已收口为 `protected_root_requires_approval`。
- 当前 bridge 隔离状态目录直接拒绝，是因为它会破坏运行边界本身。
- 当前对 `move / rename / copy` 等词已做最小去歧义：讨论计划不等于执行动作。
- 当前 bridge 自有 install lifecycle 仍走 bridge action 审批闭环；对应内部 reason code 为 `install_lifecycle_requires_approval`。

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

## 契约矩阵维护约束

- `docs/contract-matrix.md` 是顶层约束到测试映射的统一契约层（开发治理层，不是运行时子系统）。
- 当 V1 行为语义发生变化（产品边界、权限边界、连续性、可观测性、命令面、跨平台语义）时，必须在同一改动同步更新该矩阵与测试映射。
- 该约束用于收紧评审与回归覆盖，不授权 bridge 增加普通文本语义接管或新增运行时命令面。

## `/codex` 命令面

### V1 contract

- 普通文本默认直接进入 `Codex` task 路径；bridge 不要求用户先学习单独的一套桥接命令。
- 显式 `/codex` 模式优先贴近原生 `Codex CLI` 的概念与参数名。
- 显式续写保留原生命名 `resume`，但 bridge 主路径不开放 session id / thread name / `--last` 等选择面；task 已激活时普通文本仍是默认续写路径。
- 当前显式启动 / 续写只收口三类启动参数：`--cd`、`--model`、`--reasoning`。
- 当前显式启动 / 续写额外支持原生权限参数：`--sandbox`、`--ask-for-approval`。
- `/codex --cd ... <prompt>` 的语义是“在指定目录启动一轮 Codex 任务”，不是“仅切目录不执行”；若只写“进入目录/切换目录”这类空提示词，也会按普通任务执行并等待模型返回。
- `--reasoning` 当前只是启动参数表面，内部映射到 `codex exec -c model_reasoning_effort=...`；不改变普通文本 lane 归属。
- `--sandbox danger-full-access` 是当前“新会话直接申请完全访问”的原生入口；首次仍走必要确认，确认后该 paired DM 会记住 `full_access`。
- 若当前 DM 已记住 `full_access`，显式 `/codex ... --sandbox workspace-write ...` 是当前最小心智的反向操作：本轮按普通沙箱启动，并清掉该 DM 记住的 `full_access` 默认值。
- `--sandbox` 决定沙箱边界；`--ask-for-approval` 只决定审批策略。两者不是同义词，`--ask-for-approval never` 不等于 `danger-full-access`。
- 即使普通文本提到 `~/.openclaw`、`~/.codex`、模型名或思考等级，只要它不是显式 `/codex ...` 启动面，也仍归 `Codex` lane。
- bridge 只在显式 `/codex ...` 或自有审批 / 控制面闭环里做最薄 gate，不接管普通发给 Codex 的内容语义。
- 上游会话 reset 的语义也只接受官方 hook 信号；bridge 不对普通文本额外做 reset 语义猜测。
- bridge 原则上唯一新增并长期保留的用户主命令是 `/codex doctor`。
- `/codex doctor` 当前输出真实健康摘要：`Codex CLI`、`bwrap`、隔离 Feishu 凭据、gateway，再加一条具体下一步。
- 未知 `/codex <subcommand>` 返回简短、native-first 的提示，不再回退到旧帮助页。
- 历史 `/codex` 兼容命令已关闭执行；它们只返回关闭提示，不再承担迁移、恢复、状态或审批入口语义。
- 当前文档明确对外的显式入口只有：

```text
/codex --cd <path> --model <model> --reasoning <level> <prompt>
/codex --cd <path> --sandbox danger-full-access <prompt>
/codex resume --model <model> --reasoning <level> <prompt>
/codex doctor
```

- 推荐示例（可直接复制）：

```text
/codex --cd /path/to/workspace 帮我先执行 pwd 并概览当前目录结构
```

- 历史 slash 命令 `help / status / abort / approve / cwd / pwd / continue` 已全部关闭执行；用户表面统一回到 native-first 提示。
- 历史顶层 session 命令 `/new / reset` 在 paired bridge 私聊表面也已关闭，不再旁路到上游会话切换。
- 这些旧命令当前只会返回简短的 unknown / native-first 指引，不再承担迁移、恢复或显式兜底语义。

### V1 当前行为

- 普通文本在 `awaiting_input` 时默认续任务，包括恢复后的 `awaiting_input`
- `running` 时，普通文本仍不能插队
- `awaiting_approval` 时，普通文本不再当普通任务执行，而是仅在当前显式审批闭环里先进入 bridge 审批判定
- 若当前 DM 已记住 `full_access`，显式 `/codex ...` 新任务与 `/codex resume ...` 续写默认都以高权限 lane 启动；普通文本仍保持原有 lane 归属，不因此被 bridge 接管
- 若当前 DM 已记住 `full_access`，但显式 `/codex` 同时给出更保守的原生沙箱参数（当前为 `--sandbox workspace-write`），则以该显式原生参数为准，并把该 DM 默认权限切回 `normal`
- 自然语言审批始终是主路径；旧的 token 命令已不再作为可执行入口保留
- `item.completed`、`turn.started` 这类内部事件不会直接回传给用户
- 运行中状态回传默认使用“同卡片刷新”：优先更新同一条进度卡片；长任务按分段间隔退避，且状态未变化时不重复推送。

## 输入协议矩阵

### `no_task`

- 普通文本：允许，创建新 task
- `/codex doctor`：目标命令；用于 bridge 真实健康摘要

### `awaiting_input`

- 普通文本：允许，续到同一 task 的下一次 run
- 若该 task 带“上一轮执行中断”语义：普通文本仍允许，默认按自然语言继续
- `/codex doctor`：目标命令；用于 bridge 真实健康摘要

### `running`

- 普通文本：拒绝，不能插队，不得隐式继续
- `/codex doctor`：目标命令；用于 bridge 真实健康摘要

### `awaiting_approval`

- 普通文本：由 bridge 先按当前审批 contract 处理；这是显式审批闭环内的最薄 gate，而不是 bridge 接管普通 Codex 内容语义
- 审批卡片可视化按钮：点击“同意/不要执行”仅等价于发送同名自然语言回复，不新增命令语义
- `同意`：允许，创建同一 task 的新的获批 run
- `同意，并……`：条件允许；只有当尾部补充要求不放大已批准边界时，才会一并带入新的获批 run；若尾部新引入 bridge-owned 控制面或 deny 边界，则保持原审批未消费并提示重新发起
- `不要执行`：允许，拒绝这次高风险动作，并回到安全的 `awaiting_input`
- `为什么要审批？`、`你看着办`、`1`（未显式给编号选项时）：不授权，保持审批态继续解释
- `/codex doctor`：目标命令；用于 bridge 真实健康摘要

### `bridge_action.awaiting_approval`

- 普通文本：由 bridge 先按当前控制面审批处理；这是控制面闭环内的最薄 gate，不意味着 bridge 接管普通 Codex 内容语义
- `同意`：允许，由 bridge 直接执行当前已拥有的控制面动作
- `同意，并……`：拒绝追加尾巴；V1 只接受纯批准
- `不要执行`：允许，安全结束本次 bridge action，不终止原有 task
- `为什么要审批？`、`你看着办`、`1`（未显式给编号选项时）：不授权，保持审批态继续解释

## 关键规则

- `/codex doctor` 是 bridge 原则上唯一新增的主命令
- 高风险审批对 `codex task` 当前会同时写入 DM-scoped `full_access`：它既批准这一次获批 run，也把当前 paired DM 的默认启动权限切到高权限，直到显式 `/codex ... --sandbox workspace-write ...` 降权或 reset
- 当前待审批记录会持久化一个最薄 typed `approvalGrant`；当前只服务 `codex task` 的下一次获批 run。真正启动前会复核 `taskId / approvalToken / action / intent / promptDigest / executionBoundaries / effects`，若 grant 与当前 run 不一致，则保持原审批未消费
- 若审批后的 run 在真正启动前失败，原 approval token 不应被提前吞掉
- 若同一 approval token 已成功启动过一次 run，即使审批文件删除滞后，也不得再次启动第二次 run
- 默认自然语言优先；`awaiting_approval` 的普通文本也允许继续对话，但 bridge 只在当前显式审批闭环里守住最薄审批边界
- 当 task 已处于 `awaiting_approval` 时，新输入仍先走原 task 的审批语义，不并行新建 `bridge action`
- 当已有 `bridge action` 处于 `running` 时，不并行启动第二个仓库自有控制面动作
- bridge 只劫持“纯”的仓库自有控制面动作；若同一句话同时带有普通工作语义与仓库控制面语义，默认回落给 Codex task 路径
- bridge 只劫持仓库自有控制面动作；如 `请重启 nginx`、`docker restart xxx` 仍不属于 bridge action

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

## 运行时回归测试命名

- 当前运行时回归测试文件：
  - `extensions/codex-bridge/test/runtime-compatibility.test.js`
  - `extensions/codex-bridge/test/runtime-contract.test.js`
  - `extensions/codex-bridge/test/codex-exec.test.js`
  - `extensions/codex-bridge/test/persistence-reliability.test.js`
  - `extensions/codex-bridge/test/task-store.test.js`
- 当前命名前缀格式：
  - `runtime/<topic>/<scope>: <case>`
  - `protocol/<topic>/<scope>: <case>`（当测试落点仍属于 task protocol / persistence protocol 时）
- 当前约定：兼容性、运行约束、持久化可靠性测试，应优先采用 `runtime/...`；task 协议语义保持 `protocol/...`。

## 当前已知限制

- `codex exec --json` 的事件聚合做的是宽松兼容解析；当前会过滤低信号内部事件，只保留用户可感知的状态提示
- 高风险审批仍是文本协议，不依赖卡片；兼容 token 入口仍保留，但不再作为默认教学表面
- 若 bridge 重启后发现持久化里仍有旧的 `running bridge action`，当前会 fail-closed 回收到 `status=finished, resultStatus=failed`，而不是尝试恢复该控制面动作
- 非 `/codex` 的 slash 命令不会被 bridge claim
- `plugins.allow` 目前保持为空，因此 OpenClaw 会提示本地非 bundled 插件被显式发现；这不影响运行
- 当前 bundled OpenClaw `2026.3.22` 在启动阶段可能在 active runtime snapshot 建立前重复跑一次 `feishu` 插件的 `full register`；若 `channels.feishu.appSecret` 仍是 `env SecretRef`，日志会出现数次 `channels.feishu.appSecret: unresolved SecretRef ...`。只要随后仍出现 `starting feishu[default]` 与 `ws client ready`，当前将其视为上游非阻塞告警，不影响 Feishu channel 实际连通

## 恢复语义

- 若 bridge 重启后发现持久化里仍有旧的 `running` task，会先把它回收到 `awaiting_input`
- 该 task 会保留为当前活动 task，用户可以直接用自然语言继续
- 对用户提示为“上一轮执行中断，请直接说明要继续做什么”
- 若中断原因可判定为“桥接器所在 service 被它自己重启”，则提示更具体的恢复语义，而不是只给通用中断文案
- 当前不根据“长时间无心跳”自动改写 task 状态；无心跳只用于观测，不用于推断执行已死
