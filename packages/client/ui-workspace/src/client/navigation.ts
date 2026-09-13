/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param sessionId - listed or retained Session to display.
   */
  openSession(sessionId: SessionId): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session, skipped after supersession.
   * @returns completion; a superseded request may create a Session but does not open it.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session and open the child unless a later navigation supersedes it.
   * @param sessionId - source Session.
   * @returns completion; a superseded request leaves its child available without selecting it.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and, when it is the current selection, steer the stage
   * onward by the same rule that follows a deletion.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Restore an archived Session to Workspace grouping surfaces.
   * @param sessionId - Session to restore.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Physically destroy a Session's durable log. Refused while the Session is
   * active; callers should stop the running Agent first.
   * @param sessionId - Session to delete.
   */
  deleteSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }

    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  openSession(sessionId: SessionId): void {
    this.sessions.open(sessionId)
    this.ctx.layout.selectPanel(null)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const isCurrent = (): boolean => !navigation.aborted
    const sessionId = await this.connectWorkspace(workspaceId)
    if (!isCurrent()) return
    beforeOpen?.(sessionId)
    if (isCurrent()) this.openSession(sessionId)
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const childId = await this.sessions.fork({ sessionId, increaseTitle: true })
    if (!navigation.aborted) this.openSession(childId)
  }

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.sessions.clear()
      this.ctx.layout.selectPanel(null)
      return
    }
    void this.openWorkspace(target).catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    const wasCurrent = this.sessions.list.getSnapshot().current === sessionId
    await this.workspaces.archiveSession(sessionId)
    // Archiving the current Session drops the selection through
    // clearArchivedCurrent, which alone strands the stage on the no-session
    // hero: a blank new-session look whose Workspace chip falls back to the
    // "Choose workspace" placeholder. Steer it onward by the same rule that
    // follows a deletion, so both removal actions leave the same stage.
    // Archiving a non-current Session never moves the stage.
    if (wasCurrent) this.navigateAfterRemoval(sessionId, 'archive')
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async deleteSession(sessionId: SessionId): Promise<void> {
    const wasCurrent = this.sessions.list.getSnapshot().current === sessionId
    await this.sessions.delete(sessionId)
    // Deleting the current Session leaves the layout on the no-session empty
    // state (masked gap). Navigate onward instead; when no destination exists
    // the destroyed selection is still retained, so clear it to settle on that
    // empty state. Deleting a non-current Session never moves the stage.
    if (wasCurrent && !this.navigateAfterRemoval(sessionId, 'delete')) this.sessions.clear()
  }

  /**
   * Steer the stage after the current Session left the browsing surface,
   * either physically destroyed (delete) or archived. Prefers the owning
   * Workspace's most recently updated remaining Session (user-chosen ordering:
   * recency beats list position). When the Workspace has no remaining engaged
   * Session, reuse its blank placeholder or create a fresh one through the
   * normal connect path — the same "open a new Session" flow the New Session
   * affordance drives. A removed Session outside every Workspace falls back to
   * the most recently active Workspace.
   * @param removedId - the Session that just left the browsing surface.
   * @param action - the removal that triggered it, for the failure diagnostic.
   * @returns whether a destination exists. False leaves the caller to decide
   *   the empty-stage policy; archive never needs one, because its archive-set
   *   echo already cleared the selection.
   */
  private navigateAfterRemoval(removedId: SessionId, action: 'delete' | 'archive'): boolean {
    const workspaces = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const workspace = workspaces.items.find(item => item.sessionIds.includes(removedId))
    const target = workspace?.workspaceId
      ?? (workspaces.phase === 'ready' ? recentWorkspace(workspaces.items, sessions.byId) : undefined)
    // No Workspace to steer toward: report the empty stage rather than
    // inventing a Session the user did not ask for.
    if (target === undefined) return false
    const remaining = mostRecentSession(
      target,
      this.workspaces.list.getSnapshot(),
      this.sessions.list.getSnapshot(),
      removedId,
    )
    if (remaining !== undefined) {
      this.sessions.open(remaining)
      return true
    }
    // No engaged Session remains in the target Workspace: connect (reuse the
    // blank placeholder or create a fresh one) and open it.
    void this.connectWorkspace(target).then(
      (sessionId) => { this.sessions.open(sessionId) },
      (reason: unknown) => { console.warn(`session ${action} navigation failed:`, reason) },
    )
    return true
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      // Bootstrap restores the most recently updated Session of the most
      // recently active Workspace WITHOUT creating one: a cold start with no
      // Session stays on the empty state, and a cleared selection (deleted or
      // archived current Session) after reload never invents a Session the
      // user did not ask for.
      const recent = mostRecentSession(target, workspace, sessions)
      if (recent === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      // Guard against a stale snapshot: by the time the microtask settles,
      // the stage may already hold a selection.
      queueMicrotask(() => {
        if (this.lifetime.signal.aborted || initial !== 'connecting') return
        if (this.sessions.list.getSnapshot().current !== undefined) {
          initial = 'done'
          return
        }
        this.sessions.open(recent)
        initial = 'done'
      })
    }
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.sessions.clear()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/**
 * The most recently updated engaged Session of one Workspace, excluding one
 * optional id (the just-deleted Session, whose summary may still be visible in
 * a stale snapshot). Blank placeholders are skipped: they carry no content and
 * the connect path reuses them on demand.
 * @param workspaceId - target Workspace.
 * @param workspaces - Workspace snapshot (membership authority).
 * @param sessions - Session list snapshot.
 * @param exclude - Session id to ignore (usually the deleted one).
 * @returns the recency-winner id, or undefined when none remains.
 */
function mostRecentSession(
  workspaceId: WorkspaceId,
  workspaces: WorkspaceSnapshot,
  sessions: SessionListState,
  exclude?: SessionId,
): SessionId | undefined {
  const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
  if (workspace === undefined) return undefined
  const archived = new Set(workspaces.archivedSessionIds)
  let selected: SessionId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const id of workspace.sessionIds) {
    if (id === exclude || archived.has(id)) continue
    const session = sessions.byId[id]
    if (session === undefined || session.blank) continue
    if (selected === undefined || session.updatedAt > selectedTime) {
      selected = id
      selectedTime = session.updatedAt
    }
  }
  return selected
}

export { UiWorkspaceService }
