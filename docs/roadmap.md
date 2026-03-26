# Roadmap

> 这是进行时文档。只记录当前阶段、已落地、缺口、风险与下一步，不复述北极星与裁决条文。

## 当前阶段定位

当前阶段仍处于 `P0`：先把现有远程 `Codex` Runner 做成可信、连续、边界清晰的系统。

## 已落地

- `codex-bridge` 已形成可回归的基础测试面；当前桥接测试基线为 `node --test extensions/codex-bridge/test/*.test.js`。
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
- bridge 控制面的终局形态尚未产品化，尤其是显式控制模式与 `doctor` 的最小落地尚未开始。

## 当前风险

- 受控执行仍部分依赖表面语义匹配，后续若继续堆 prompt-level 特判，系统会重新变厚。
- bridge 控制面若继续扩张命令面或自然语言接管面，会重新制造第二主角。
- 文档与实现若再次混写，后续判断会重新失去边界。

## 下一步最小推进项

- 继续收口 `P0 / 受控执行能力`，优先稳固 action-boundary model。
- 继续收口真实链路中的 control-plane 一致性，优先排查纯 service / health 场景的归属漂移。
- 把最新文档体系与实现主线重新对齐，确保 north star、decision baseline、roadmap 各司其职。

## 暂不推进项

- 暂不扩 bridge 的用户命令面。
- 暂不实现 `doctor` 自动自愈。
- 暂不把 operator / break-glass 控制面完整产品化。
- 暂不为新渠道和体验花样提前改动核心语义。
