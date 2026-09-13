/** session.delete command: active guard, archive-set cleanup, and physical destroy. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionDeleteRequest } from '../src/types.ts'

function controllerAgents(): unknown {
  return {
    ensureSession: () => Promise.resolve(),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
  }
}

async function harness(overrides: {
  runningAgent?: SessionId
  idleAgent?: SessionId
  liveSession?: SessionId
  archived?: readonly SessionId[]
  subagents?: readonly SessionId[]
  runningSubagent?: SessionId
} = {}): Promise<{
  ctx: Context
  controller: SessionCommandController
  persistence: { destroy: ReturnType<typeof vi.fn> }
  registry: {
    unarchiveSession: ReturnType<typeof vi.fn>
    list: () => { id: string; detachSession: ReturnType<typeof vi.fn> }[]
  }
  detachSession: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  const persistence = { destroy: vi.fn(() => Promise.resolve()) }
  const detachSession = vi.fn(() => Promise.resolve())
  const registry = {
    unarchiveSession: vi.fn(() => Promise.resolve()),
    list: () => [{ id: 'workspace-a', detachSession }],
    detachSession,
  }
  const liveAgents = new Map<string, unknown>()
  if (overrides.runningAgent !== undefined) liveAgents.set(overrides.runningAgent, { status: 'running' })
  if (overrides.idleAgent !== undefined) liveAgents.set(overrides.idleAgent, { status: 'idle' })
  if (overrides.runningSubagent !== undefined) liveAgents.set(overrides.runningSubagent, { status: 'running' })
  // A live (idle) session exercises the real registry so we can assert that a
  // physical delete also expels it — otherwise @-mention discovery keeps listing
  // a session whose durable log is gone.
  await ctx.plugin(SessionStore)
  if (overrides.liveSession !== undefined) {
    liveAgents.set(overrides.liveSession, { status: 'idle' })
    const session = ctx.sessions.prepare(overrides.liveSession, { meta: { cwd: '/workspace' } })
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
  }
  ctx.provide('agents', { get: (id: SessionId) => liveAgents.get(String(id)) } as never)
  ctx.provide('sessionPersistence', persistence as never)
  ctx.provide('workspaceRegistry', registry as never)
  if (overrides.subagents !== undefined || overrides.liveSession !== undefined) {
    // Trace-based cascade: descendants are discovered from the corpus only
    // when the spec asks for subagents. The mock mirrors the real
    // SessionLineageTrace tree (children nested under their parent).
    const traceSession = vi.fn(async (sessionId: SessionId) => {
      const subagent = (id: SessionId): { session: { header: { id: SessionId; origin: string } }; descendants: unknown[] } => ({
        session: { header: { id, origin: 'subagent' } },
        descendants: [],
      })
      const children = overrides.subagents?.map(subagent) ?? []
      return {
        target: { header: { id: sessionId } },
        ancestors: [],
        descendants: children,
        complete: true,
      }
    })
    ctx.provide('sessionQuery', { traceSession } as never)
  }
  const controller = new SessionCommandController(ctx, controllerAgents() as never, '/default')
  return { ctx, controller, persistence, registry, detachSession }
}

describe('SessionCommandController.delete', () => {
  it('rejects a Session whose Agent is still running with session-active', async () => {
    const { controller } = await harness({ runningAgent: SessionId('hot') })
    await expect(controller.delete({ sessionId: SessionId('hot') }))
      .rejects.toMatchObject({ code: 'session/active' })
  })

  it('deletes a Session whose Agent is idle (ended turn, instance retained)', async () => {
    const { controller, persistence, registry } = await harness({ idleAgent: SessionId('idle') })
    const request: SessionDeleteRequest = { sessionId: SessionId('idle') }
    await expect(controller.delete(request)).resolves.toEqual({ deleted: true })
    expect(registry.unarchiveSession).toHaveBeenCalledWith(SessionId('idle'))
    expect(persistence.destroy).toHaveBeenCalledWith(SessionId('idle'))
  })

  it('deletes an ended-but-unarchived Session (in-memory store entry, no running Agent)', async () => {
    const { controller, persistence, registry } = await harness({ liveSession: SessionId('idle') })
    const request: SessionDeleteRequest = { sessionId: SessionId('idle') }
    await expect(controller.delete(request)).resolves.toEqual({ deleted: true })
    expect(registry.unarchiveSession).toHaveBeenCalledWith(SessionId('idle'))
    expect(persistence.destroy).toHaveBeenCalledWith(SessionId('idle'))
  })

  it('clears the archive set and physically destroys a cold Session', async () => {
    const { controller, persistence, registry } = await harness({ archived: [SessionId('cold')] })
    const request: SessionDeleteRequest = { sessionId: SessionId('cold') }
    await expect(controller.delete(request)).resolves.toEqual({ deleted: true })
    expect(registry.unarchiveSession).toHaveBeenCalledWith(SessionId('cold'))
    expect(persistence.destroy).toHaveBeenCalledWith(SessionId('cold'))
  })

  it('is safe when no Session is archived: still destroys physically', async () => {
    const { controller, persistence, registry } = await harness()
    await expect(controller.delete({ sessionId: SessionId('cold') }))
      .resolves.toEqual({ deleted: true })
    expect(registry.unarchiveSession).toHaveBeenCalledWith(SessionId('cold'))
    expect(persistence.destroy).toHaveBeenCalledWith(SessionId('cold'))
  })

  it('expels a live session from the registry so discovery stops offering it', async () => {
    const { ctx, controller } = await harness({ liveSession: SessionId('idle') })
    expect(ctx.sessions.get(SessionId('idle'))).toBeDefined()
    await expect(controller.delete({ sessionId: SessionId('idle') })).resolves.toEqual({ deleted: true })
    expect(ctx.sessions.get(SessionId('idle'))).toBeUndefined()
  })

  it('detaches the destroyed session from its owning workspace account', async () => {
    const { controller, detachSession } = await harness()
    await expect(controller.delete({ sessionId: SessionId('cold') })).resolves.toEqual({ deleted: true })
    expect(detachSession).toHaveBeenCalledWith(SessionId('cold'))
  })

  it('destroys subagent descendants before the requested Session', async () => {
    const child = SessionId('child')
    const grandchild = SessionId('grandchild')
    const { controller, persistence, detachSession } = await harness({
      subagents: [child, grandchild],
    })
    // Both are direct children of the root in this mock; destruction order
    // is child-first, then the root (grandchild is a sibling here, not a
    // deeper descendant, so both run before the root).
    await expect(controller.delete({ sessionId: SessionId('root') })).resolves.toEqual({ deleted: true })
    const destroyed = persistence.destroy.mock.calls.map(([id]) => String(id))
    expect(destroyed).toEqual(['child', 'grandchild', 'root'])
    expect(detachSession).toHaveBeenCalledWith(SessionId('root'))
    expect(detachSession).toHaveBeenCalledWith(SessionId('child'))
  })

  it('destroys nested descendants deepest-first', async () => {
    const child = SessionId('child')
    const grandchild = SessionId('grandchild')
    const { ctx, controller, persistence } = await harness({
      subagents: [child, grandchild],
    })
    // Override the trace with real nesting: grandchild under child.
    const query = ctx.get('sessionQuery') as unknown as { traceSession: ReturnType<typeof vi.fn> }
    query.traceSession.mockResolvedValue({
      target: { header: { id: SessionId('root') } },
      ancestors: [],
      descendants: [{
        session: { header: { id: child, origin: 'subagent' } },
        descendants: [{
          session: { header: { id: grandchild, origin: 'subagent' } },
          descendants: [],
        }],
      }],
      complete: true,
    })
    await expect(controller.delete({ sessionId: SessionId('root') })).resolves.toEqual({ deleted: true })
    const destroyed = persistence.destroy.mock.calls.map(([id]) => String(id))
    expect(destroyed).toEqual(['grandchild', 'child', 'root'])
  })

  it('refuses deletion while a subagent descendant is running', async () => {
    const child = SessionId('child')
    const { controller, persistence } = await harness({
      subagents: [child],
      runningSubagent: child,
    })
    await expect(controller.delete({ sessionId: SessionId('root') }))
      .rejects.toMatchObject({ code: 'session/active' })
    expect(persistence.destroy).not.toHaveBeenCalled()
  })

  it('tolerates a Session absent from the corpus and destroys only the root', async () => {
    const { ctx, controller, persistence } = await harness()
    // Deleting a session whose corpus entry is absent (idempotent cold
    // delete) must destroy the root and not throw: the trace reports
    // SESSION_QUERY_SESSION_NOT_FOUND and the cascade falls back to the root.
    const disposer = ctx.provide('sessionQuery', {
      traceSession: vi.fn(async () => {
        throw new SessionQueryError('session not found', 'SESSION_QUERY_SESSION_NOT_FOUND')
      }),
    } as never)
    try {
      await expect(controller.delete({ sessionId: SessionId('cold') })).resolves.toEqual({ deleted: true })
    } finally {
      disposer()
    }
    const destroyed = persistence.destroy.mock.calls.map(([id]) => String(id))
    expect(destroyed).toEqual(['cold'])
  })
})
