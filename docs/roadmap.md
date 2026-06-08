# Roadmap

> 这是进行时文档。只记录当前阶段、已落地、缺口、风险与下一步，不复述北极星与裁决条文。

## 当前阶段定位

当前阶段仍处于 `P0`：先把现有远程 `Codex` bridge 做成可信、连续、边界清晰的系统。

当前更精确位点：`P0-收口 IV（反馈闭环阶段）`。

- 重点从“仅把桥做薄”升级为“在保持薄桥前提下，把远程闭环做稳”。
- 当前判定标准从“用户可感知行为稳定 + 跨平台语义显式 + 评审可追溯”升级为“同会话回流稳定 + 用户可消费产物可闭环送达 + 评审可追溯”。
- `docs/contract-matrix.md` 已作为开发治理层引入；它约束文档与测试，不新增任何 bridge 运行时命令面。

## 已落地

- 顶层文档体系已完成重写收口；当前残余问题主要在措辞层，不再继续大改结构。
- `codex-bridge` 已形成可回归的基础测试面；当前桥接测试基线为 `node --test extensions/codex-bridge/test/*.test.js`。
- `/codex` 用户表面已完成一轮 native-first 收口：普通消息默认直达 `Codex`，显式入口明确只保留 `/codex --cd ... [--model ...] [--reasoning ...] [--sandbox ...] [--ask-for-approval ...] <prompt>`、`/codex resume <prompt>` 与 `/codex doctor`；原生 `resume` 的 session id / thread name / `--last` 选择面明确不纳入 bridge 主路径。
- 未知 `/codex <subcommand>` 已不再回落旧帮助页，而是返回简短的 native-first 指引。
- 历史 slash 命令 `help / status / abort / approve / cwd / pwd / continue` 已全部退出执行面，只保留 unknown / native-first 提示。
- 受控执行已有最小 allow / approval / deny 边界与测试。
- 任务状态机已有 `no_task / awaiting_input / running / awaiting_approval` 的基本协议。
- 高风险审批已具备单次、run-scoped、启动前复核、失败不吞 token 的基础语义。
- bridge 自有控制面已形成最小闭环：独立对象、独立审批 lane、独立持久化、独立恢复。
- 入口层对普通任务的误劫持已完成一轮收口，混合语义默认回落 `Codex`。
- 启动前高风险 gate 已进一步收口到显式 `/codex` 启动 / 续写面；普通文本即使提到 `~/.openclaw`、`~/.codex`、模型或思考等级，也仍留在 `Codex` lane。
- 恢复与审计已有最小底座：task / run / approval / bridge action 已分开持久化，并有 fail-closed recovery。
- bridge-owned control-plane 归属已补出最小 `capability / effect / routing / decision` assessment 骨架，不再只剩最终 decision。
- `routing` 与 `runtime-control-plane` 测试已开始从 prompt 变体穷举，收向 lane contract 与 fallback contract 的主保护。
- `/codex doctor` 已从最小入口升级为真实健康摘要：会汇总 `Codex CLI`、`bwrap`、隔离 Feishu 凭据与 gateway 状态。
- 契约矩阵已进入开发治理门禁：PR 模板已要求语义变更时同步说明矩阵更新，CI 新增 `contract-matrix-guard` 自动校验核心语义文件变更与矩阵联动。
- 体验回归清单已固定：新增 `docs/experience-regression-checklist.md` 与一键脚本 `scripts/review/run-experience-regression.sh`，把连续性/审批/重启恢复/长任务观测收敛成固定回归条目。
- 顶层方向已完成升级：`Feishu` 不再只被视为远程输入渠道，而被明确为 `Codex` 的低心智远程闭环交互面。
- 新的阶段顺序已明确：先收口同会话反馈闭环，再渐进扩展更复杂的飞书对象协作能力。
- `reply plane` 的最小设计 contract 已完成第一轮收口：已明确 same-origin 默认闭环、manifest-only 产物声明、相对 `cwd` 产物边界、低噪音展示原则与 fail-closed 回传原则。
- `docs/contract-matrix.md` 已补入 reply-plane 第一阶段所需的 `future` 治理行：覆盖 same-origin、manifest-only、相对 `cwd`、低噪音展示与跨平台一致性。
- `reply plane` 第一阶段已进入当前行为：`finishTask` 已解析 `Delivery Manifest`，会把 Codex 显式声明的最终产物按当前任务 origin 原路回到 Feishu；本地路径收口为相对 `cwd`，非法路径 / 缺失文件 / 类型不匹配 / 上传失败都会 fail closed，摘要照常返回。
- `reply plane` 已补最小 proof：`codex-exec` 提示词、manifest 解析/校验、same-origin native delivery、失败聚合短提示，以及 `native_windows_fast` 下的同语义回归都已进入测试面。

## 未落地

- 执行边界模型仍未完全从 prompt / regex 信号升级为更稳定的 action-boundary / capability 模型；当前只是在 bridge-owned control-plane 归属上补出了最小骨架。
- 真实链路下的控制面归属仍未完全收稳，尤其是纯 control-plane 场景的一致性仍需继续验证。
- 渠道解耦 contract 尚未真正抽稳，当前核心语义仍主要长在 Feishu + OpenClaw 接线内。
- 反馈闭环的后续阶段仍未落地：当前已完成 same-origin + manifest-only 的第一阶段，但显式跨 origin override、更丰富的飞书对象协作与更细粒度的 origin/thread 约束仍未进入运行时主路径。
- 飞书上下文归属 contract 的第一阶段已形成运行时语义与测试 proof；但更细粒度的 thread/origin 显式 override、跨渠道抽象与后续对象级回传约束仍未进入运行时主路径。
- 飞书对象协作能力尚未进入受控阶段：文档、日历、多维表格等对象当前只能视为后续扩展方向，尚未形成不增 bridge 产品面的实现路径。
- “用户显式改口可偏离 origin” 仍只保留为后续能力保留位；当前 `P0-收口 IV` 阶段不开放跨 origin 投递执行。
- 历史 compat slash 命令虽已关闭执行，但相关实现残影、文案残影与测试命名仍需继续收口。
- 测试面对新宪法的保护权重仍不足；虽然 `routing` 与 `runtime-control-plane` 已开始收向 lane contract，但整体仍有不少 regex 识别和旧兼容实现保护残留。

## 当前风险

- 受控执行仍部分依赖表面语义匹配，后续若继续堆 prompt-level 特判，系统会重新变厚。
- bridge 控制面若继续扩张命令面或自然语言接管面，会重新制造第二主角。
- 若把反馈闭环直接实现为 bridge 对高层飞书业务语义的理解与编排，bridge 会重新变厚并演化为第二产品。
- 若在闭环能力尚未收稳前同步铺开 Docs / Calendar / Base 等对象操作，复杂度会先于体验价值增长。
- 文档与实现若再次混写，后续判断会重新失去边界。
- 后续实现收口以“**不够明确，就不接**”为默认裁决准则。

## 当前阶段执行口径

- bridge 的正确演化方向不是更聪明，而是更迟钝。
- 当前主线不是继续扩大 bridge 能力面，而是在不增用户心智的前提下，把反馈闭环做成默认行为。
- 除显式入口、显式审批闭环与极少数硬命中的 bridge-owned 动作外，其余输入默认回 `Codex`。
- 默认闭环优先沿当前飞书会话上下文成立，而不是让用户频繁指定回传位置、投递方式或上下文绑定。
- 第一阶段只收口任务状态、结果与用户可消费产物的同会话回流，不提前把 bridge 扩张成飞书业务助手。
- 对象协作能力只在反馈闭环稳定之后渐进展开，且不得破坏“Codex 是主角、bridge 是最薄连接层”的顶层约束。

## 本轮执行层审计结论

- 顶层三件套与用户表面已完成第一轮对齐；`/codex new` 回落旧帮助页这一类明显偏差已被收口。
- 当前主要矛盾已从“用户表面仍在教旧命令”转为“实现结构与测试权重仍保留旧时代中心性”。
- `node --test extensions/codex-bridge/test/*.test.js` 全绿，只能证明当前实现自洽；不能自动证明当前测试权重已经完全服务新的顶层宪法。
- 2026-03-26 实机核对 `codex --help` 后确认：当前原生 `Codex CLI` 明确存在 `resume`、`fork`、`--cd`、`--model`、`--sandbox`、`--ask-for-approval` 等表面；当前 bridge 用户表面则主动收口为 `/codex --cd ...`、`/codex resume ...`、`/codex doctor`，显式参数透传集中在 `--cd`、`--model`、`--reasoning`、`--sandbox`、`--ask-for-approval`，并不存在 `new / status / abort / approve / cwd / pwd / continue` 这组历史兼容命令。
- 上游 0.117–0.120 审计补注：本阶段只吸收兼容性 / 稳定性 / 内部执行改进，保持薄桥契约不变。
- 上游新增体验与扩展（插件浏览、MCP 丰富度、app-server/remote 流程、Realtime 语音、TUI 文案/状态细化、多 agent 交互优化）当前仅记录为非优先适配项，不扩 bridge 产品面。

## `/codex` 命令面对齐现状

- 默认工作流仍以“普通消息直达 `Codex`”为主；用户不应被迫先学习 bridge 命令。
- 显式 `/codex` 模式已优先贴近原生 `Codex CLI`：当前主入口已收口到原生参数名与原生显式入口。
- bridge 原则上唯一应新增并长期保留的用户主命令仍是 `/codex doctor`。
- `/codex new` 不应再被当作正确主路径；当前用户可见表面已不再把它当主路径教学。
- `status / abort / approve / help / cwd / pwd / continue` 这组历史命令已不再作为可执行入口保留。
- 用户表面现只保留原生显式入口与 `/codex doctor`；其余旧命令统一回到 unknown / native-first 提示。
- 未知 `/codex <subcommand>` 当前已返回简短、面向新约定的指引，不再把用户重新拉回旧帮助心智。
- bridge 只在显式 `/codex ...` 或自有审批 / 控制面闭环里做最薄启动 gate；普通文本继续默认归 `Codex`。

## 测试面对齐现状

- 保留：任务状态机、审批 token、task / run / bridge action 持久化、fail-closed recovery、bridge 与 `codex task` 边界分离这类协议型测试。
- 已完成：围绕“普通消息默认透传 `Codex`、显式 `/codex` 优先贴近原生、`doctor` 为唯一桥新增主命令、未知子命令不再喷旧帮助”的最小执行验收测试已补上。
- 已完成：围绕“显式启动 gate 不再抢普通文本、`doctor` 输出真实运行时摘要”的回归测试已补上。
- 已开始：`routing` 与 `runtime-control-plane` 已把一部分保护重点切到 lane contract、fallback contract 与 continuity contract。
- 仍需保留但降权：bridge-owned control-plane 与“混合语义默认回落 `Codex`”这类边界测试；它们仍有价值，但不再等价于产品体验已对齐。
- 下一步重写重点：所有仍把历史 compat 命令残影当成主契约的断言，以及仍只断言最终 decision 而不看 capability / routing 的测试。
- 下一步收缩重点：剩余大量按措辞穷举的 prompt/regex 变体测试，只保留 owned / mixed / ambiguous / non-owned 四类代表性样本；避免旧表面匹配测试继续绑架新设计。

## 下一步最小推进项

1. 先把 `reply plane` Phase 1 的体验与治理收稳：补齐 README / 对外叙事、体验回归条目与审查口径，避免文档继续落后于当前行为。
2. 再继续补强运行时 proof：把“同会话回流、低噪音状态、产物可送达、连续任务不失联”持续固化为固定回归条目与可执行测试。
3. 然后才评估 `reply plane` 的后续扩展：仅在不增用户心智和不增 bridge 产品面的前提下，审视显式 override、thread 约束与对象级回传边界。
4. 最后再进入对象协作扩展评估：在反馈闭环稳定之后，逐步评估 Docs / Drive / Calendar / Base 等飞书对象能力的开放顺序。

## 暂不推进项

- 暂不扩 bridge 的用户命令面。
- 暂不把 bridge 做成飞书业务助手、对象代理或第二产品。
- 暂不在反馈闭环未稳定前铺开文档、日历、多维表格等对象操作。
- 暂不把 `doctor` 自动自愈作为主线。
- 暂不为新渠道和体验花样提前改动核心语义。
- 暂不把 `codex exec` prompt 迁移到 stdin：需要改动 `buildCodexArgs` 合约与 `spawn` 的 stdio，可能影响错误处理与复现实验路径，先保留 argv 方案。
- 暂不执行 “去 OpenClaw + 私聊默认直接接管 + DM 长期 lane/thread + 移除用户可见 `/codex resume`” 这一整套新产品重定义。该方向已记录在 [docs/superpowers/specs/2026-05-11-dm-native-lane-rearchitecture-deferred-design.md](/media/mzh/2TB1/codex_feishu/docs/superpowers/specs/2026-05-11-dm-native-lane-rearchitecture-deferred-design.md)，当前明确处于挂起状态，待 transport host、连续性模型与版本再验证条件成熟后再重启评估。
