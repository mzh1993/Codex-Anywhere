# Codex WS Backend PoC（治理对齐版）

> 目标：验证 `codex app-server (ws)` 是否可作为 **执行后端** 的可行替代层；不替代 OpenClaw 的 Feishu 通道与配对壳，不改变当前默认主路径。

## 1) 范围与非目标

### 范围（PoC 内）

- 新增一条可开关的实验执行后端：`ws_backend`。
- 在显式 `/codex ...` 启动面上，允许将“任务执行通道”切到 `codex app-server(ws)`。
- 复用现有 bridge 的：
  - 路由入口与命令面
  - 审批与策略判定
  - task/run 持久化
  - 卡片更新与结果回传

### 非目标（PoC 外）

- 不替换 OpenClaw 网关、Feishu 通道、pairing 机制。
- 不新增用户命令面（不新增 `/codex ws ...` 等）。
- 不放宽权限边界、不绕开审批。
- 不改默认后端：默认仍为现有执行路径。

## 2) 治理约束映射

- `PB-001/PB-002`：普通文本仍归 Codex lane；仅显式 `/codex ...` + bridge 自有闭环可触发后端选择。
- `PM-*`：审批/拒绝逻辑保持原样，后端仅是执行载体，不是策略裁决者。
- `CT-*`：同 task lane 连续性保持不变；后端切换不改变 task 语义。
- `OB-*`：同一进度卡/完成卡风格与预算不变。
- `CS-*`：命令面不扩张，继续 native-first。
- `XP-*`：保持跨平台语义一致；Windows 差异仅在既有 allowed-diff 范围内。

> 若 PoC 进入“默认行为变更”阶段，需同步更新 `docs/contract-matrix.md` 相关行并补 proof。

## 3) 后端抽象（最小接口）

定义执行器抽象（仅 bridge 内部）：

- `startRun(context) -> handle`
- `streamEvents(handle, onEvent)`
- `stopRun(handle, reason)`
- `probe() -> { ok, details }`

两种实现：

- `cli_backend`：现有 `spawn(codex, args, env)` 路径（默认）。
- `ws_backend`：连接 `codex app-server(ws)` 的 PoC 实现。

## 4) 时序（PoC）

1. Feishu 收到显式 `/codex ...`。
2. 走现有路由/策略/审批判定。
3. 进入 `startTask` 时读取 `experimentalBackend`：
   - `cli`：走现有路径；
   - `ws`：走 ws 执行器。
4. 运行事件映射为现有 `task_progress`/心跳/finish 流。
5. 若 ws 建连失败或中途不可恢复错误：
   - 该 run 标注失败原因（可见 hint）；
   - **可选** PoC 回落：同 task 新开一个 `cli` run（仅当配置允许）。
6. finish 卡片和 reply-plane 仍使用现有渲染/投递路径。

## 5) 配置设计（默认关闭）

在 `plugins.entries."codex-bridge".config` 增加：

- `executionBackend: "cli" | "ws"`（默认 `cli`）
- `wsBackendUrl: "ws://127.0.0.1:18766"`（仅 `ws` 时使用）
- `wsBackendAuthTokenEnv: "CODEX_WS_BACKEND_TOKEN"`（可空）
- `wsBackendAutoFallbackToCli: true`（PoC 建议默认 `true`）

约束：

- 未显式启用前，行为与当前完全一致。
- `doctor` 展示“当前执行后端 + ws 连通性”。

## 6) 文件级改动清单（建议）

### A. 新增文件

- `extensions/codex-bridge/lib/execution-backend.js`
  - 后端抽象与选择器（`cli` / `ws`）。
- `extensions/codex-bridge/lib/execution-backend-cli.js`
  - 对现有 spawn 逻辑做轻薄包装（避免逻辑分叉）。
- `extensions/codex-bridge/lib/execution-backend-ws.js`
  - ws 建连、事件读取、停止与错误归一化（PoC）。
- `extensions/codex-bridge/test/execution-backend.test.js`
  - 后端选择、fallback、错误映射。

### B. 变更文件

- `extensions/codex-bridge/lib/settings.js`
  - 新增配置读取和默认值（默认 `cli`）。
- `extensions/codex-bridge/index.js`
  - 把执行入口从“直接 spawn”收口到后端抽象。
  - 保持 task/run 持久化与卡片逻辑不变。
- `extensions/codex-bridge/lib/runtime-compatibility.js`
  - `probe` 增补 ws 后端可用性检查（仅启用时）。
- `extensions/codex-bridge/lib/locale.js`
  - 新增最小 doctor 文案字段（后端与连通性）。
- `extensions/codex-bridge/test/runtime-compatibility.test.js`
  - 覆盖 ws backend probe 与 fail-closed 行为。
- `extensions/codex-bridge/test/runtime-control-plane.test.js`
  - 验证开启 ws backend 时命令面与审批语义不变。

### C. 文档

- `docs/feishu-codex-bridge-v1.md`
  - 增加“执行后端（实验开关）”说明。
- `docs/contract-matrix.md`
  - 仅当行为语义发生可见变化时更新 proof。

## 7) 验收与回滚

### 验收（PoC 通过条件）

- 显式 `/codex` 在 `executionBackend=ws` 下可跑通完整 run。
- 审批语义与拒绝语义与 `cli` 后端一致。
- 同任务连续 run、重启恢复、finish 卡片预算不退化。
- reply-plane same-origin 不变。

### 回滚

- 配置一键回滚：`executionBackend=cli`。
- 代码回滚：PoC 为新增模块+最小接线，避免侵入式改动。

## 8) 风险清单（PoC 阶段）

- `codex app-server` 协议仍属实验能力，版本变更可能破坏兼容。
- ws 会话断线与重连策略不当会影响 OB-001 的卡片稳定性。
- 事件语义不完全等价时，可能出现“可见提示缺失/抖动”。

对应缓解：

- 固定 codex 版本基线（当前 `0.121.0`）。
- 先跑镜像回归：同一输入同时比对 `cli/ws` 的 run 输出形态。
- fallback 默认开启，PoC 期以可恢复优先。

---

如果进入实现阶段，建议按顺序：

1. 先做后端抽象 + `cli` 包装（零行为变化）。
2. 再接 `ws` 后端（默认关）。
3. 最后补 `doctor` 展示与回归测试矩阵。
