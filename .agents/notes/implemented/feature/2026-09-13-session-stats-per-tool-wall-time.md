# Agent Note: Session stats carry a per-tool wall-time breakdown

Status: implemented

English | [中文](2026-09-13-session-stats-per-tool-wall-time.zh.md)

## Problem

The `sessionStats` projection reported one scalar `toolMs` for the whole session, so the Web stats dialog could only say how much time tools consumed, never which tool consumed it. The fold already paired `tool/call` → `tool/result` by callId and already had the tool name in hand on the `tool/call` payload; it discarded it. A session that spent its wall time in one slow `bash` command and a handful of fast reads rendered identically to one spread evenly across every tool.

## Decision

`SessionStatsProjection` gains `tools`: an array of `{ name, calls, ms }` entries, one per tool name with at least one matched call→result pair, ranked by descending `ms`. `toolMs` keeps its existing meaning and the breakdown partitions it exactly — every `ms` figure is a `Math.max(0, result − call)` delta booked both into the scalar and into the entry for the name recorded on the `tool/call`. `SessionStatsToolTotal` in [types.ts](../../../../packages/session/session-stats/src/types.ts) declares the entry; `sessionStatsProjectionDefinition.stateVersion` moves to `2`, so persisted cache rows from the previous unit are discarded and refolded rather than read as a value without `tools`.

**The breakdown is a ranked array, not a name-keyed map.** `pendingCalls` widens from `Record<string, number>` to `Record<string, { time, name }>`, and [accrueToolTotal](../../../../packages/session/session-stats/src/projection.ts) merges each settlement into the array and re-sorts it. A map would need a sort on every view or every event to produce a ranked list, and the JSON key plane cannot faithfully carry arbitrary model-supplied names (`__proto__` is dropped by object spread and by zod's record parsing — measured, not assumed), so a tool literally named `__proto__` would silently vanish. The array keys on the name itself. Merging folds the delta into the existing entry (or appends a new name) and sorts by descending `ms`; `Array.prototype.toSorted` is stable, so an entry that grows past its neighbor moves up its rank while equal totals keep first-settlement order, and an unfolding replay over the same log reproduces the same array. The fold stays a single pass over events and never rescans the log. The wire schema's `superRefine` rejects a non-descending array, because the ranking is the contract clients render.

**The client renders it as a ranked list under the time figures.** [StatsPills.tsx](../../../../packages/client/ui-chat/src/client/chat/StatsPills.tsx) draws the tool total as the existing `Tool time` row and adds a `data-session-stats-tools` ordered list beneath it: name, localized call count, and duration. Tool names are logged data and render verbatim — `stats.dialog.toolBreakdown` and the `stats.dialog.toolCalls.one`/`.other` plural keys are the only new copy, so a name is never localized and an unknown tool needs no dictionary entry. The window fallback fold derives the same array so an assembly without the projection keeps the panel; a result whose call head fell outside the window contributes to `toolMs` but names no tool, exactly as an unmatched call does in the projection.

## Alternatives considered

**A `Record<string, { calls, ms }>` on the wire.** The obvious representation, and the one the fold's `pendingCalls` shape suggested. Rejected on two counts: producing the ranked list the UI wants would move the sort to every consumer or every view computation, and prototype-named keys do not survive the JSON object plane — `Object.fromEntries`, spread, and zod's record parse all drop `__proto__`, so the map would report a different tool set than the log contains. The array keeps the ranking and the names.

**Sort in `wire.view` instead of on write.** Keeps one representation and pushes ranking to read time. Rejected because `view` runs on every change-feed emission and the identity gate compares view references: re-sorting would allocate a new array per emission and defeat the `Object.is` gate that keeps the feed quiet for unchanged figures.

**Rank by call count rather than wall time.** Counts are stable and cheap. Rejected because the dialog exists to explain where the session's time went; a fast tool called fifty times would outrank the one that consumed the minute.

**A separate `toolBreakdown` projection key.** Isolates the new field's version churn. Rejected because the breakdown is not independently observable — it re-states `toolMs` and shares its pairing rules — and a second key would double the pending-call bookkeeping for one consumer.

**Name the tool from the `tool/result` side.** Would let the fold skip the `pendingCalls` widening. Rejected because `tool/result` carries only the callId; the name exists solely on `tool/call`.

## Consequences

A session's tool time is now attributable: the Web time dialog ranks tools by consumed wall time, and any other projection consumer reads the same array. `stateVersion: 2` discards every persisted `sessionStats` row on the first read after the upgrade and refolds from the log, which is the intended cost of the state-schema change; the archived fixtures in `session-projection-cache/tests/fixtures/` still open (their `ver: 1` `sessionStats` rows are simply unusable and refold), and the fold's own cached rows remain a shortcut, never an authority.

The projection README pair documents the field, the ranking, and the "a renamed tool reports separately, an unsettled call is absent rather than zero, PTC sub-calls stay in the parent figure" limits. `packages/session/session-stats/tests/projection.spec.ts` pins the ranking, the tie order, the rank-up reorder, the total/partition agreement, and the schema's rejection of an unsorted wire array; `packages/client/ui-chat/tests/chat-stats.client.spec.tsx` pins the window fallback ranking, the headless-result split, and the localized dialog list. The browser fixture mirror in [fixture.ts](../../../../packages/client/connection/src/client/fixture.ts) folds the same array so the keyless Web lanes see the shipped shape.
