# Agent Note: Archive-current Session navigation

Status: implemented

English | [中文](2026-09-13-archive-current-session-navigation.zh.md)

## Problem

Archiving the open Session stranded the stage on the no-session hero. `watchNavigation`'s `clearArchivedCurrent` dropped the selection when the current id entered the archive set, and nothing steered onward. With `sessionId === undefined` the conversation renders the centered hero, and `chipTitle` resolves to `undefined`, so the Workspace chip fell back to its placeholder copy (`hero.chooseWorkspace`) — read by users as "a new session with no workspace".

Deleting the current Session had the same starting point and already navigated onward through `navigateAfterDelete`. Archive, added later, never received the equivalent.

## Decision

`archiveSession` captures whether the target is the current selection, awaits the archive, and then steers the stage through the same rule deletion uses; a non-current archive never moves the stage.

The shared steering moved from `navigateAfterDelete` to `navigateAfterRemoval(removedId, action)`, which prefers the owning Workspace's most recently updated remaining engaged Session, then the Workspace's reusable blank, then a fresh Session through `connectWorkspace`. It reports whether a destination exists instead of clearing unconditionally: delete passes `wasCurrent` and clears when nothing remains, while archive relies on the archive-set echo that already cleared the selection, so exactly one `clear()` runs on each path.

`mostRecentSession` remains the destination chooser: recency beats list position, blank placeholders are skipped, and an archived member never matches.

## Alternatives considered

**Keep the archived-note behavior (archive returns to the hero).** The [archive-set note](../../archived/feature/2026-07-31-session-archive-global-set.md) records this as a deliberate user decision from the original archive feature. It was reconsidered and reversed: archiving is a visibility action over one Session, and the same Workspace still holds available Sessions the user was working among. Dropping to the hero discards that context and presents a chip reading "Choose workspace", which misstates the surviving Workspace. The reversal is scoped to the stage destination; the archive set, its durability, and its filtering are unchanged.

**Navigate only when the Workspace still has a member Session; otherwise stay on the hero.** Leaves the chip mislabeled in exactly the case the report describes and makes the behavior depend on Workspace occupancy rather than on a single rule.

**Clear before navigating, then reuse the delete path verbatim.** The archive echo already cleared the selection, so an unconditional clear would fire twice on the archive path — once from the echo, once from the helper — and a second `clear()` publishes a redundant selection transition.

**Select the next row in list order rather than by recency.** List position is a presentation order (the browser can be in a manual, browser-local order); deletion already settled on recency, and two removal actions with different destination rules are harder to predict.

## Consequences

Archive and delete now leave the same stage, and the archive path is covered for the four destination cases: a remaining sibling, a reusable blank, a fresh Session, and no destination at all. The two properties that must keep holding are pinned by tests — a non-current archive never moves the stage, and the last-Workspace archive clears exactly once. `navigateAfterRemoval`'s return value is the mechanism that keeps the clear count at one per path; a future third caller must decide its empty-stage policy rather than inheriting whichever one it copies.

The archived-note behavior is superseded by this decision while the archive set itself remains current under the [session-history note](../../implemented/architecture/2026-08-18-session-history-and-event-transport.md). The reversal is recorded here because the older note is frozen; it is not edited.
