/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * One tool name's whole-log usage: how many matched `tool/call` → `tool/result`
 * pairs settled under that name and their summed wall time. The name is the
 * verbatim `tool/call` payload value, never a localized label.
 */
export interface SessionStatsToolTotal {
  /** The `tool/call` event's `name` field, verbatim. */
  readonly name: string
  /** Matched call→result pairs recorded under this name. */
  readonly calls: number
  /** Summed wall time over those pairs, ms. */
  readonly ms: number
}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 (or `tools` empty) until its first contributing event
 * lands. Field names mirror the client window fold so an assembly without
 * this unit can fall back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /**
   * Per-tool-name breakdown of `toolMs`: one entry per tool name that settled
   * at least one matched pair, sorted by descending `ms`. Equal totals order
   * deterministically from the settlement sequence, so an unfolding replay
   * over the same log reproduces the array. Names whose calls resolved
   * through `turn/end` pruning never appear.
   */
  tools: readonly SessionStatsToolTotal[]
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
