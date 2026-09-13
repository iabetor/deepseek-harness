/** Document renderer slot: the owner supplies shared file state, renderers own their presentation. */
import type { PropsRuntime, SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RefCallback } from 'react'

/** One loaded text window, retaining source line positions. */
export interface DocumentTextPage {
  readonly offset: number
  readonly text: string
  readonly lines: number
}

/**
 * Contents prepared by the preview owner using ordinary file reads.
 * Byte arrays are transient UI input, never persisted layout or Session data.
 */
export type DocumentContent =
  | { readonly kind: 'text'; readonly text: string; readonly pages: readonly DocumentTextPage[]; readonly eof: boolean }
  | { readonly kind: 'bytes'; readonly data: Uint8Array<ArrayBuffer> }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Document body selected by a registered implementation id. */
    'sidebar.right.tab.document': {
      kind: 'keyed'
      scope: 'session'
      owner: {
        /** Original file address, also readable through the standard useResource hook. */
        readonly resourceAddress: string
        /** Loaded content; text is an accumulated prefix until eof. */
        readonly content: DocumentContent
        /** The document toolbar's current wrapping preference. */
        readonly wrap: boolean
        /** Report a renderer-owned scrollport; passing `null` restores the shared body as the owner. */
        readonly scrollportRef: RefCallback<HTMLElement>
        /**
         * Re-read this document from its first line after the renderer itself
         * changed the file.
         *
         * A renderer that writes to the file it displays (an editor, or a
         * change-review overlay applying or reverting a hunk) then holds content
         * the Host has already superseded. The owner learns that only from the
         * version on a later metadata frame, and answers it with the manual
         * "file changed, showing previous content" bar — right for a change the
         * reader did not make, needless friction for one the renderer just made
         * and can report itself. Calling this reuses the owner's own reload path,
         * so the pages, the observed version, and that bar settle in one step
         * instead of waiting for the reader to click. The scroll position holds.
         *
         * No-op when the document cannot be read or has no loaded version yet.
         */
        readonly reload: () => void
      }
      hookContext: UseSidebarRightTabInfo
      inject: {
        hooks: {
          tabInfo: SlotHookFactory<'sidebar.right.tab.document', UseSidebarRightTabInfo>
        }
      }
    }
  }
}

/** Standard input for every document body; entry-local stores and locale props can be intersected with it. */
export type DocumentPreviewProps = PropsRuntime<'sidebar.right.tab.document'>

/**
 * Forward the framework's tab reader to the selected document body.
 * @param _standard - framework standard props.
 * @param useTabInfo - enclosing tab's bound reader.
 * @returns the same reader, without another subscription adapter.
 */
export const documentTabInfoFactory: SlotHookFactory<'sidebar.right.tab.document', UseSidebarRightTabInfo> =
  (_standard, useTabInfo) => useTabInfo
