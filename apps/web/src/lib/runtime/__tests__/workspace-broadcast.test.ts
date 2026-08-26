import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  publishWorkspaceEvent,
  subscribeWorkspaceEvents,
} from '../workspace-broadcast'

describe('workspace-broadcast', () => {
  const unsubscribers: Array<() => void> = []

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
    delete globalThis.workspaceBroadcastListeners
  })

  it('delivers published events to the subscriber', () => {
    const listener = vi.fn()
    unsubscribers.push(subscribeWorkspaceEvents('u1', listener))

    publishWorkspaceEvent('u1', { type: 'knowledge.proposals_changed' })

    expect(listener).toHaveBeenCalledWith({ type: 'knowledge.proposals_changed' })
  })

  it('does not deliver another user’s events to a subscriber', () => {
    const aliceListener = vi.fn()
    unsubscribers.push(subscribeWorkspaceEvents('alice', aliceListener))

    publishWorkspaceEvent('bob', { type: 'knowledge.proposals_changed' })

    expect(aliceListener).not.toHaveBeenCalled()
  })

  it('isolates distinct users subscribed at the same time', () => {
    const aliceListener = vi.fn()
    const bobListener = vi.fn()
    unsubscribers.push(subscribeWorkspaceEvents('alice', aliceListener))
    unsubscribers.push(subscribeWorkspaceEvents('bob', bobListener))

    publishWorkspaceEvent('alice', { type: 'knowledge.proposals_changed' })

    expect(aliceListener).toHaveBeenCalledTimes(1)
    expect(bobListener).not.toHaveBeenCalled()

    publishWorkspaceEvent('bob', { type: 'knowledge.proposals_changed' })

    expect(aliceListener).toHaveBeenCalledTimes(1)
    expect(bobListener).toHaveBeenCalledTimes(1)
  })

  it('stops delivery after unsubscribe and cleans the registry', () => {
    const listener = vi.fn()
    const first = subscribeWorkspaceEvents('u1', listener)
    unsubscribers.push(first)

    first()

    publishWorkspaceEvent('u1', { type: 'knowledge.proposals_changed' })
    expect(listener).not.toHaveBeenCalled()
    expect(globalThis.workspaceBroadcastListeners?.has('u1')).toBe(false)
  })

  it('keeps remaining listeners when only some unsubscribe', () => {
    const kept = vi.fn()
    const removed = vi.fn()
    const removeKept = subscribeWorkspaceEvents('u1', kept)
    unsubscribers.push(removeKept)
    const removeRemoved = subscribeWorkspaceEvents('u1', removed)
    unsubscribers.push(removeRemoved)

    removeRemoved()

    publishWorkspaceEvent('u1', { type: 'knowledge.proposals_changed' })
    expect(kept).toHaveBeenCalledTimes(1)
    expect(removed).not.toHaveBeenCalled()
    expect(globalThis.workspaceBroadcastListeners?.get('u1')?.size).toBe(1)
  })

  it('is a no-op when no one is listening', () => {
    expect(() =>
      publishWorkspaceEvent('nobody', { type: 'knowledge.proposals_changed' }),
    ).not.toThrow()
  })
})
