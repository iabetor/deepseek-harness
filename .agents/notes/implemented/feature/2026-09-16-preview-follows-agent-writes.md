# Agent Note: Preview follows agent writes

Status: implemented

English | [中文](2026-09-16-preview-follows-agent-writes.zh.md)

## Problem

The document preview announced a change instead of applying it: a write the reader did not make raised a bar over the loaded pages and waited for a click. That rule was chosen to keep the reader's place while an agent wrote a file repeatedly, and it is [recorded with the shipped preview](2026-09-05-sidebar-text-preview-and-file-tree.md).

For the file an agent is actually working on, the rule costs more than it protects. A reader watching a diff has no unsaved work to lose: the body is a viewer, and the pending content is already superseded on disk. The bar makes them fetch what the product already knows is stale, and until they do, a renderer that overlays change metadata on the body — the change-review view that dsh-striatum contributes through the document seat — draws new line positions over old text, because Observation carries a version while the loaded pages carry the previous one.

## Decision

A write this tab did not make re-reads on its own. `TextPreview` compares the loaded version and the version observed when that read began against the later `WorkspaceFileStat.version` from `useResource<'file'>`; a difference schedules one `reload` through the same face the header control uses. Nothing new was added to the resource model, the preview face, or the store.

Four rules bound the automatic read:

- **Observations settle first.** One agent turn can write a file several times, and each write emits one Host observation. The re-read runs 200 ms after the last observation, so a burst becomes the single read that reflects its end state.
- **Only a visible tab reads.** `useTabInfo().tab.visible` gates the effect: a collapsed Sidebar, or a pane whose active tab is another one, holds its content until the reader can see it, then reads. No file is read for nobody, and no hidden scroll position is disturbed.
- **A failed metadata frame outranks a change.** The failure line keeps the reload the reader asks for, and no automatic read runs over it.
- **A renderer's own write is immediate.** A body that wrote this file reports it through the `reload` owner prop ([document preview operations](../architecture/2026-09-08-document-preview-operations.md)); the settle window never delays it.

The change bar and its `changed` copy are gone: the reload it offered is now what happens, and the reload control in the header remains for a reader who wants one.

A re-read empties the body before its first page returns, and a scroller with no height clamps its own offset to zero and reports the move. The body's scroll handler ignores a scroll event while it holds no content, so the recorded place survives the window in which the browser would otherwise overwrite it with that zero.

## Alternatives considered

**Keep the bar and make it more prominent.** The defect is not that the bar is easy to miss; it is that a viewer asks permission to show current content. A louder bar keeps the stale text and the misaligned overlay.

**Reload on every observation.** One turn that writes a file five times would re-read five times, flashing the body through four intermediate states that are already superseded. The burst is the unit a reader cares about, not the write.

**Read every tab, visible or not.** A background tab's read is work nobody asked for, and its result moves a scroll position under content the reader is not looking at. Waiting for visibility delivers the same content at the moment it can be used.

**Hold the reader's place by restoring the scroll offset from the path row.** The body already records its offset in the tab store and restores it after a reload; the zero a collapsed scroller reports was the only thing overwriting it. Ignoring that report fixes the case without a second position source.

**Re-read only the loaded range instead of from the first line.** A reload restarts at page one, so a file past the page cap loses pages the reader had scrolled to. Keeping the range needs a new read path in the face and the store, and the pages of a file large enough to page are also the ones whose change metadata is least likely to fit one view. Deferred rather than rejected: the automatic read reuses the existing path until a case needs the range preserved.

## Consequences

A reader watching a file the agent is editing sees current content without asking for it, and a renderer overlaying that file's change metadata lines up with the text it draws over. The bar's copy and its dictionary key left the package.

What the automatic read does not cover is the boundary the Host already has: `fs/observed` is emitted by instrumented filesystem operations, so an agent that writes through a shell command, or an editor outside the product, produces no observation and no read. The preview is not stale by inattention in that case; it was never told. The header's reload control remains the answer there, and the [Workspace Files service](../architecture/2026-09-05-workspace-files-service.md) owns the observation contract.

A file longer than the Host's page cap re-reads from its first line, so a reader who had scrolled past several pages returns to the pages the automatic read fetches. Verification is `packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx`, which pins the automatic read, the merge window, the hidden tab's wait, and the place the reader keeps; and `tests/document-seat.client.spec.tsx`, which pins a writing renderer's immediate re-read.

## Related

- [Sidebar text preview and file tree](2026-09-05-sidebar-text-preview-and-file-tree.md) — the preview this note changes; its "announced, not applied" rule no longer holds.
- [Document preview and file addresses](../architecture/2026-09-08-document-preview-operations.md) — the resource observation split and the `reload` owner prop.
- [Workspace Files service](../architecture/2026-09-05-workspace-files-service.md) — `stat`, the paged `read`, and the observed-write contract behind the version this reads.
