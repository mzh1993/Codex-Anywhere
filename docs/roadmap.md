# Roadmap

> 这是进行时文档。只记录当前阶段、已落地、缺口、风险与下一步，不复述北极星与裁决条文。

## 当前阶段定位

当前阶段仍处于 `P0`：先把现有远程 `Codex` bridge 做成可信、连续、边界清晰的系统。

当前更精确位点：`P0-收口 III（制度化阶段）`。

- 重点不再是新增能力，而是把“顶层三件套 -> 契约矩阵 -> 测试证明”固化为默认工作方式。
- 当前判定标准从“实现自洽”升级为“用户可感知行为稳定 + 跨平台语义显式 + 评审可追溯”。
- `docs/contract-matrix.md` 已作为开发治理层引入；它约束文档与测试，不新增任何 bridge 运行时命令面。

## 已落地

- 顶层文档体系已完成重写收口；当前残余问题主要在措辞层，不再继续大改结构。
- `codex-bridge` 已形成可回归的基础测试面；当前桥接测试基线为 `node --test extensions/codex-bridge/test/*.test.js`。
- `/codex` 用户表面已完成一轮 native-first 收口：普通消息默认直达 `Codex`，显式入口优先支持 `/codex --cd ... [--model ...] [--reasoning ...] <prompt>`、`/codex resume [--model ...] [--reasoning ...] <prompt>` 与 `/codex doctor`。
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

## 未落地

- 执行边界模型仍未完全从 prompt / regex 信号升级为更稳定的 action-boundary / capability 模型；当前只是在 bridge-owned control-plane 归属上补出了最小骨架。
- 真实链路下的控制面归属仍未完全收稳，尤其是纯 control-plane 场景的一致性仍需继续验证。
- 渠道解耦 contract 尚未真正抽稳，当前核心语义仍主要长在 Feishu + OpenClaw 接线内。
- 协作体验层基本尚未展开，低噪音状态表达、结构化结果、图片/渲染结果仍在后面。
- 历史 compat slash 命令虽已关闭执行，但相关实现残影、文案残影与测试命名仍需继续收口。
- 测试面对新宪法的保护权重仍不足；虽然 `routing` 与 `runtime-control-plane` 已开始收向 lane contract，但整体仍有不少 regex 识别和旧兼容实现保护残留。

## 当前风险

- 受控执行仍部分依赖表面语义匹配，后续若继续堆 prompt-level 特判，系统会重新变厚。
- bridge 控制面若继续扩张命令面或自然语言接管面，会重新制造第二主角。
- 文档与实现若再次混写，后续判断会重新失去边界。
- 后续实现收口以“**不够明确，就不接**”为默认裁决准则。

## 当前阶段执行口径

- bridge 的正确演化方向不是更聪明，而是更迟钝。
- 后续实现目标不是继续提升 bridge 的语义识别能力，而是持续删除 bridge 的语义判断能力。
- 除显式入口、显式审批闭环与极少数硬命中的 bridge-owned 动作外，其余输入默认回 `Codex`。
- mixed、ambiguous、需要猜测、需要上下文延伸的输入，一律不应由 bridge 接管。
- 当前主线不是“更准地识别 bridge 请求”，而是“更少地认领输入”。

## 本轮执行层审计结论

- 顶层三件套与用户表面已完成第一轮对齐；`/codex new` 回落旧帮助页这一类明显偏差已被收口。
- 当前主要矛盾已从“用户表面仍在教旧命令”转为“实现结构与测试权重仍保留旧时代中心性”。
- `node --test extensions/codex-bridge/test/*.test.js` 全绿，只能证明当前实现自洽；不能自动证明当前测试权重已经完全服务新的顶层宪法。
- 2026-03-26 实机核对 `codex --help` 后确认：当前原生 `Codex CLI` 明确存在 `resume`、`fork`、`--cd`、`--model`、`--sandbox`、`--ask-for-approval` 等表面；当前 bridge 用户表面则主动收口为 `--cd`、`--model`、`--reasoning` 三类显式启动参数，并不存在 `new / status / abort / approve / cwd / pwd / continue` 这组原生命令名。

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

1. 先收敛 `P0-收口 III` 的两条体验主线：任务连续性可感知稳定、执行中状态可观测稳定（减少“卡片失联/语义跳 lane”体感）。
2. 再完成契约矩阵与测试映射的首轮补齐（优先权限边界与跨平台 allowed-diff 行），把“行为变更必更新矩阵”执行成默认门禁。
3. 然后进入 `P1-泛化部署`：在不扩用户心智和不增 bridge 产品面的前提下，推进 Linux/Windows 一键安装与运维可复制性。

## 暂不推进项

- 暂不扩 bridge 的用户命令面。
- 暂不实现 `doctor` 自动自愈。
- 暂不把 operator / break-glass 控制面完整产品化。
- 暂不为新渠道和体验花样提前改动核心语义。
