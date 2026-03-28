# Roadmap

> 这是进行时文档。只记录当前阶段、已落地、缺口、风险与下一步，不复述北极星与裁决条文。

## 当前阶段定位

当前阶段仍处于 `P0`：先把现有远程 `Codex` bridge 做成可信、连续、边界清晰的系统。

## 已落地

- 顶层文档体系已完成重写收口；当前残余问题主要在措辞层，不再继续大改结构。
- `codex-bridge` 已形成可回归的基础测试面；当前桥接测试基线为 `node --test extensions/codex-bridge/test/*.test.js`。
- `/codex` 用户表面已完成一轮 native-first 收口：普通消息默认直达 `Codex`，显式入口优先支持 `/codex --cd ... <prompt>`、`/codex resume ...` 与 `/codex doctor`。
- 未知 `/codex <subcommand>` 已不再回落旧帮助页，而是返回简短的 native-first 指引。
- 旧 compat 命令已从帮助主文案、审批主文案与运行中提示中退居次级，不再继续充当产品主命令面。
- 受控执行已有最小 allow / approval / deny 边界与测试。
- 任务状态机已有 `no_task / awaiting_input / running / awaiting_approval` 的基本协议。
- 高风险审批已具备单次、run-scoped、启动前复核、失败不吞 token 的基础语义。
- bridge 自有控制面已形成最小闭环：独立对象、独立审批 lane、独立持久化、独立恢复。
- 入口层对普通任务的误劫持已完成一轮收口，混合语义默认回落 `Codex`。
- 恢复与审计已有最小底座：task / run / approval / bridge action 已分开持久化，并有 fail-closed recovery。

## 未落地

- 执行边界模型仍未完全从 prompt / regex 信号升级为更稳定的 action-boundary / capability 模型。
- 真实链路下的控制面归属仍未完全收稳，尤其是纯 control-plane 场景的一致性仍需继续验证。
- 渠道解耦 contract 尚未真正抽稳，当前核心语义仍主要长在 Feishu + OpenClaw 接线内。
- 协作体验层基本尚未展开，低噪音状态表达、结构化结果、图片/渲染结果仍在后面。
- `doctor` 已有最小入口与摘要格式，但 gateway 仍是占位探测，尚未成为可信健康摘要。
- 旧 compat 命令仍以内部分支形式留在主 dispatcher 中，尚未真正下沉为 compat layer。
- 测试面对新宪法的保护权重仍不足；当前大量测试仍在保护 regex 识别和旧兼容实现，而不是优先保护新的命令面与单主角体验。

## 当前风险

- 受控执行仍部分依赖表面语义匹配，后续若继续堆 prompt-level 特判，系统会重新变厚。
- bridge 控制面若继续扩张命令面或自然语言接管面，会重新制造第二主角。
- 文档与实现若再次混写，后续判断会重新失去边界。

## 本轮执行层审计结论

- 顶层三件套与用户表面已完成第一轮对齐；`/codex new` 回落旧帮助页这一类明显偏差已被收口。
- 当前主要矛盾已从“用户表面仍在教旧命令”转为“实现结构与测试权重仍保留旧时代中心性”。
- `node --test extensions/codex-bridge/test/*.test.js` 全绿，只能证明当前实现自洽；不能自动证明当前测试权重已经完全服务新的顶层宪法。
- 2026-03-26 实机核对 `codex --help` 后确认：当前原生 `Codex CLI` 明确存在 `resume`、`fork`、`--cd`、`--model`、`--sandbox`、`--ask-for-approval` 等表面；并不存在 `new / status / abort / approve / cwd / pwd / continue` 这组原生命令名。

## `/codex` 命令面对齐现状

- 默认工作流仍以“普通消息直达 `Codex`”为主；用户不应被迫先学习 bridge 命令。
- 显式 `/codex` 模式已优先贴近原生 `Codex CLI`：当前主入口已收口到原生参数名与原生显式入口。
- bridge 原则上唯一应新增并长期保留的用户主命令仍是 `/codex doctor`。
- `/codex new` 不应再被当作正确主路径；当前用户可见表面已不再把它当主路径教学。
- `status / abort / approve / help` 仍可作为远程壳阶段性兼容控制面保留，但应降级为兼容入口，不再作为产品主命令面继续放大。
- `cwd / pwd / continue` 代表旧命令面时期的补丁式设计；应从帮助主文案与后续产品叙事中退出，只保留短期兼容或迁移兜底。
- 未知 `/codex <subcommand>` 当前已返回简短、面向新约定的指引，不再把用户重新拉回旧帮助心智。

## 测试面对齐现状

- 保留：任务状态机、审批 token、task / run / bridge action 持久化、fail-closed recovery、bridge 与 `codex task` 边界分离这类协议型测试。
- 已完成：围绕“普通消息默认透传 `Codex`、显式 `/codex` 优先贴近原生、`doctor` 为唯一桥新增主命令、未知子命令不再喷旧帮助”的最小执行验收测试已补上。
- 仍需保留但降权：bridge-owned control-plane 与“混合语义默认回落 `Codex`”这类边界测试；它们仍有价值，但不再等价于产品体验已对齐。
- 下一步重写重点：所有仍把 compat 命令实现细节当成主契约的断言。
- 下一步收缩重点：大量按措辞穷举的 prompt/regex 变体测试，只保留 owned / mixed / ambiguous / non-owned 四类代表性样本；避免旧表面匹配测试继续绑架新设计。

## 下一步最小推进项

- 先把旧 compat 命令从主 dispatcher 中下沉为明确的 compat layer，消除实现结构上的旧命令中心性。
- 再重排测试权重：提高新命令面与单主角体验的主保护级别，降低 regex 变体穷举的权重。
- 然后继续收口 `P0 / 受控执行能力`，优先稳固 action-boundary model 与 control-plane 一致性。

## 暂不推进项

- 暂不扩 bridge 的用户命令面。
- 暂不实现 `doctor` 自动自愈。
- 暂不把 operator / break-glass 控制面完整产品化。
- 暂不为新渠道和体验花样提前改动核心语义。
