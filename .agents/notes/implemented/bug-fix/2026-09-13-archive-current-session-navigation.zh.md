# Agent Note: 归档当前 Session 的导航

Status: implemented

[English](2026-09-13-archive-current-session-navigation.md) | 中文

## Problem

归档当前打开的 Session 会把舞台滞留在无会话首屏。当当前 id 进入归档集合时，`watchNavigation` 的 `clearArchivedCurrent` 清空了选中项，而后续没有任何导航。由于 `sessionId === undefined`，会话区渲染居中首屏，且 `chipTitle` 解析为 `undefined`，Workspace chip 于是回落到占位文案（`hero.chooseWorkspace`）——用户会读成「一个新会话且没有工作区」。

删除当前 Session 的起点相同，且已经通过 `navigateAfterDelete` 继续导航。后加入的归档从未获得等价处理。

## Decision

`archiveSession` 先记录目标是否为当前选中项，等待归档完成，然后用删除所用的同一规则引导舞台；归档非当前 Session 时永不移动舞台。

共享的引导逻辑从 `navigateAfterDelete` 移到 `navigateAfterRemoval(removedId, action)`：优先选择所属 Workspace 中最近更新的剩余已参与 Session，其次是该 Workspace 可复用的 blank，最后经 `connectWorkspace` 新建一个 Session。它返回是否存在目的地，而不是无条件清空：删除传入 `wasCurrent` 并在无剩余时清空，归档则依赖归档集合回声已经清空选中项，因此每条路径都恰好执行一次 `clear()`。

`mostRecentSession` 仍是目的地选择器：最近更新优先于列表位置，跳过 blank 占位，已归档成员永不匹配。

## Alternatives considered

**保持归档笔记中的行为（归档后回到首屏）。** [归档集合笔记](../../archived/feature/2026-07-31-session-archive-global-set.md) 把这一点记录为原始归档功能中的一次有意用户决策。此处重新评估并反转：归档是针对单个 Session 的可见性操作，而同一 Workspace 仍持有用户正在其中工作的可用 Session。回落到首屏会丢弃这份上下文，并展示一个写着「选择工作区」的 chip，错误描述了仍然存在的 Workspace。反转范围仅限于舞台目的地；归档集合、其持久化与过滤规则均未改动。

**仅当 Workspace 仍有成员 Session 时才导航，否则留在首屏。** 恰恰在用户报告的该场景下仍让 chip 标注错误，并使行为依赖 Workspace 占用情况，而非一条统一规则。

**先清空再导航，原样复用删除路径。** 归档回声已经清空了选中项，因此无条件清空会在归档路径上触发两次——一次来自回声，一次来自辅助函数——而第二次 `clear()` 会发布一次多余的选中状态迁移。

**按列表顺序而非最近更新选择下一行。** 列表位置是一种展示顺序（浏览器可处于手动、浏览器本地的顺序）；删除已经确定采用最近更新，而两个移除操作使用不同的目的地规则更难预测。

## Consequences

归档与删除现在落到同一舞台，且归档路径覆盖了四种目的地情形：仍有同级 Session、可复用 blank、新建 Session，以及完全没有目的地。两条必须持续成立的性质已被测试钉住——归档非当前 Session 永不移动舞台，以及最后一个 Workspace 的归档恰好清空一次。`navigateAfterRemoval` 的返回值正是让每条路径清空次数保持为一的机制；未来第三个调用方必须自行决定其空舞台策略，而不是继承它刚好复制的那一个。

归档笔记中的行为被本决策取代，而归档集合本身仍以 [会话历史笔记](../../implemented/architecture/2026-08-18-session-history-and-event-transport.zh.md) 为当前依据。反转记录在此，因为旧笔记已冻结；它不会被编辑。
