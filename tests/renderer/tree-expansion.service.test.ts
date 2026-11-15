import { describe, it, expect, vi, afterEach } from 'vitest'
import { TreeExpansionService } from '../../src/renderer/src/services/tree-expansion.service'

// Bare prototype instance (same approach as editor-default-view.service.test.ts) — no DI bootstrap.
function makeService(prefs: Record<string, unknown> = {}) {
    const service = Object.create(TreeExpansionService.prototype) as TreeExpansionService
    const setFn = vi.fn().mockResolvedValue(undefined)
    Object.assign(service, {
        preferences: { get: vi.fn(async (k: string) => prefs[k]), set: setFn },
        expanded: new Map(),
        persistTimer: null,
        remember: true,
    })
    return { service, setFn }
}

afterEach(() => vi.useRealTimers())

describe('TreeExpansionService', () => {
    it('starts with everything collapsed and remembering enabled', async () => {
        const { service } = makeService()
        await service.init()
        expect(service.remember).toBe(true)
        expect(service.isExpanded('roster', 'folder:Yard')).toBe(false)
    })

    it('restores saved expansion when remembering is on', async () => {
        const { service } = makeService({ treeExpansion: { roster: ['folder:Yard'] } })
        await service.init()
        expect(service.isExpanded('roster', 'folder:Yard')).toBe(true)
        expect(service.isExpanded('turnouts', 'folder:Yard')).toBe(false)
    })

    it('ignores saved expansion when remembering is off', async () => {
        const { service } = makeService({ rememberTreeExpansion: false, treeExpansion: { roster: ['folder:Yard'] } })
        await service.init()
        expect(service.remember).toBe(false)
        expect(service.isExpanded('roster', 'folder:Yard')).toBe(false)
    })

    it('persists changes (debounced) only while remembering', () => {
        vi.useFakeTimers()
        const { service, setFn } = makeService()
        service.setExpanded('roster', 'a', true)
        service.setMany('roster', ['b', 'c'], true)
        service.setExpanded('roster', 'c', false)
        expect(setFn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(400)
        expect(setFn).toHaveBeenCalledTimes(1)
        expect(setFn).toHaveBeenCalledWith('treeExpansion', { roster: ['a', 'b'] })

        service.remember = false
        service.setExpanded('roster', 'd', true)
        vi.advanceTimersByTime(400)
        expect(setFn).toHaveBeenCalledTimes(1)
        expect(service.isExpanded('roster', 'd')).toBe(true) // still held for the session
    })

    it('collapseAll clears one tree only', () => {
        const { service } = makeService()
        service.setMany('roster', ['a', 'b'], true)
        service.setExpanded('turnouts', 'x', true)
        service.collapseAll('roster')
        expect(service.expandedIds('roster')).toEqual([])
        expect(service.isExpanded('turnouts', 'x')).toBe(true)
    })

    it('turning remembering off wipes the saved layout', async () => {
        const { service, setFn } = makeService()
        await service.setRemember(false)
        expect(setFn).toHaveBeenCalledWith('rememberTreeExpansion', false)
        expect(setFn).toHaveBeenCalledWith('treeExpansion', {})
    })
})
