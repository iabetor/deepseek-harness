/**
 * The delete action: one `sidebar.workspaces.session.menu.item` row over an
 * injected request, plus the `shell.overlay` dialog that confirms destroying a
 * Session's durable log. Deletion is physical and irreversible, so it stays in
 * the row menu rather than on a hover button and always asks first; a running
 * Session has no delete affordance at all, because the Host refuses deletion of
 * active work.
 */
import { useState } from 'react'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmInjected, SessionDeleteConfirmProps,
  SessionDeleteConfirmRequest, SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): ask for the destructive delete confirmation. Absent
 * when the access snapshot excludes `session/delete` for this Session, so a
 * shared viewer page never offers to erase the owner's log.
 * @param props - owner share, menu open state, access Hook, and the delete share.
 * @returns the row, or nothing when the caller may not delete this Session.
 */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, useSessionAccess, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  const deleteAllowed = useSessionAccess(sessionId, 'session/delete')
  if (!deleteAllowed) return null
  return (
    <MenuItemButton
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId, displayTitle)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming
 * destroys the durable log; cancelling leaves the Session untouched.
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSession: SessionDeleteConfirmInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session')}
      description={t('delete.session.desc', { name: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('delete.session')}
          </Button>
        </>
      )}
    >
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
