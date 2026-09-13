# Agent Note: 会话统计携带按工具的墙钟时间明细

Status: implemented

[English](2026-09-13-session-stats-per-tool-wall-time.md) | 中文

## 问题

`sessionStats` 投影只报告一个全会话标量 `toolMs`，因此 Web 统计弹窗只能说工具占用了多少时间，无法说清是哪个工具。折叠本已按 callId 配对 `tool/call` → `tool/result`，并且手中就有 `tool/call` 载荷里的工具名；但它丢弃了这个名字。一个把时间花在一条慢 `bash` 命令、外加几次快速读取的会话，与一个时间均匀分摊到各工具的会话，渲染结果完全相同。

## 决定

`SessionStatsProjection` 新增 `tools`：`{ name, calls, ms }` 条目数组，每个至少有一个已匹配调用→结果配对的工具名一条，按 `ms` 降序排列。`toolMs` 保持原有含义，而明细恰好将其分割——每个 `ms` 数字都是一个 `Math.max(0, result − call)` 增量，同时记入标量与该 `tool/call` 记录名称的条目。[types.ts](../../../../packages/session/session-stats/src/types.ts) 中的 `SessionStatsToolTotal` 声明该条目；`sessionStatsProjectionDefinition.stateVersion` 升到 `2`，因此上一单元的持久缓存行会被丢弃并重新折叠，而不是被当作缺少 `tools` 的值读取。

**明细是排序数组，不是以名称为键的映射。** `pendingCalls` 从 `Record<string, number>` 扩为 `Record<string, { time, name }>`，[accrueToolTotal](../../../../packages/session/session-stats/src/projection.ts) 把每次结算合并进数组并重新排序。映射要在每次视图或每个事件上排序才能得到排名列表，而 JSON 对象键平面无法忠实承载任意模型提供的名称（`__proto__` 会被对象展开与 zod 的 record 解析丢弃——这是实测结论，不是假设），所以一个字面名为 `__proto__` 的工具会静默消失。数组以名称本身为键。合并把增量折入既有条目（或是追加新名称），再按 `ms` 降序排序；`Array.prototype.toSorted` 是稳定排序，因此增长超过邻居的条目会向前移动排名，时间相等的条目保持先结算者在前，对同一日志的展开重放会复现同一数组。折叠仍然只对事件单遍扫描，从不重放日志。wire schema 的 `superRefine` 拒绝非降序数组，因为排序就是客户端渲染所依赖的约定。

**客户端把它渲染成时间数字下方的排名列表。**[StatsPills.tsx](../../../../packages/client/ui-chat/src/client/chat/StatsPills.tsx) 把工具总时间保留为原有的 `Tool time` 行，并在其下新增 `data-session-stats-tools` 有序列表：名称、本地化的调用次数与耗时。工具名是写入日志的数据，按原样渲染——新增文案只有 `stats.dialog.toolBreakdown` 与 `stats.dialog.toolCalls.one`/`.other` 复数键，因此名称从不本地化，未知工具也无需字典条目。窗口回退折叠派生同一数组，使没有该投影的装配仍能显示该面板；调用头落在窗口之外的结果只计入 `toolMs` 而不命名任何工具，与投影中未匹配调用的处理完全一致。

## 考虑过的替代方案

**wire 上用 `Record<string, { calls, ms }>`。** 最直观的表示，也是折叠的 `pendingCalls` 形状所暗示的。因两点拒绝：生成 UI 想要的排名列表会把排序转移到每个消费者或每次视图计算上；而原型名键无法在 JSON 对象平面上存活——`Object.fromEntries`、展开与 zod 的 record 解析都会丢弃 `__proto__`，于是该映射报告的工具集会与日志实际包含的不同。数组同时保住了排名与名称。

**在 `wire.view` 中排序，而不是写入时排序。** 保持单一表示，把排名推迟到读取时。拒绝，因为 `view` 在每次变更流发射时都会运行，而恒等门禁比较的是视图引用：重新排序会在每次发射时分配新数组，从而破坏让未变数字保持安静的 `Object.is` 门禁。

**按调用次数而非墙钟时间排名。** 次数稳定且廉价。拒绝，因为该弹窗的意义是解释会话时间花在哪里；一个被调用五十次的快工具会排在消耗掉那一分钟的工具之前。

**单独的 `toolBreakdown` 投影键。** 可隔离新字段带来的版本变动。拒绝，因为该明细并非可独立观测——它重述 `toolMs` 并共用其配对规则——而第二个键会为一个消费者重复整套待处理调用的记账。

**从 `tool/result` 一侧取工具名。** 这样折叠就不必扩宽 `pendingCalls`。拒绝，因为 `tool/result` 只携带 callId；名称只存在于 `tool/call` 上。

## 后果

会话的工具时间现在可归因：Web 时间弹窗按消耗的墙钟时间给工具排名，其他投影消费者读取同一数组。`stateVersion: 2` 会在升级后的首次读取时丢弃每一行持久化的 `sessionStats` 行并从日志重新折叠，这就是状态 schema 变更的预期代价；`session-projection-cache/tests/fixtures/` 中的归档 fixture 仍能打开（其 `ver: 1` 的 `sessionStats` 行只是不可用并会重新折叠），而折叠自身的缓存行始终只是捷径，从不是权威。

投影 README 双语对记录了该字段、排名规则，以及「改名工具单独成条、未结算调用是缺失而非零值、PTC 子调用留在父级数字里」这些限制。`packages/session/session-stats/tests/projection.spec.ts` 钉住排名、并列顺序、排名上移的重排、总量与明细的一致性，以及 schema 对未排序 wire 数组的拒绝；`packages/client/ui-chat/tests/chat-stats.client.spec.tsx` 钉住窗口回退的排名、无调用头结果的分割，以及本地化的弹窗列表。[fixture.ts](../../../../packages/client/connection/src/client/fixture.ts) 中的浏览器 fixture 镜像折叠同一数组，使无密钥 Web 通道看到已发布形状。
