import { resolve } from 'aurelia'
import { PreferencesService } from './preferences.service'

export const REMEMBER_TREE_EXPANSION_PREF = 'rememberTreeExpansion'
export const TREE_EXPANSION_PREF = 'treeExpansion'

const PERSIST_DEBOUNCE_MS = 300

/**
 * Which tree nodes (folders, #define groups, virtual turnouts, ...) are expanded, per tree.
 * Every tree starts fully collapsed; what the user opens is held here so it survives editor
 * switches and tree rebuilds. When `remember` is on (the default) the set is also persisted via
 * PreferencesService and restored on the next launch; when it's off the state lives for this
 * session only. `treeKey` is any stable string per tree ('roster', 'turnouts', 'Sensors', ...).
 *
 * Lookups are synchronous and in-memory, so trees can ask while they build; `init()` runs once
 * at startup, long before any editor mounts.
 */
export class TreeExpansionService {
    private readonly preferences = resolve(PreferencesService)
    private readonly expanded = new Map<string, Set<string>>()
    private persistTimer: ReturnType<typeof setTimeout> | null = null

    remember = true

    async init(): Promise<void> {
        const [remember, saved] = await Promise.all([
            this.preferences.get<boolean | undefined>(REMEMBER_TREE_EXPANSION_PREF),
            this.preferences.get<Record<string, string[]> | undefined>(TREE_EXPANSION_PREF),
        ])
        this.remember = remember !== false
        if (!this.remember || !saved || typeof saved !== 'object') return
        for (const [key, ids] of Object.entries(saved)) {
            if (Array.isArray(ids)) this.expanded.set(key, new Set(ids.filter((i): i is string => typeof i === 'string')))
        }
    }

    isExpanded(treeKey: string, id: string): boolean {
        return this.expanded.get(treeKey)?.has(id) ?? false
    }

    /** Ids currently expanded in a tree (a copy). */
    expandedIds(treeKey: string): string[] {
        return [...(this.expanded.get(treeKey) ?? [])]
    }

    setExpanded(treeKey: string, id: string, expanded: boolean): void {
        this.setMany(treeKey, [id], expanded)
    }

    setMany(treeKey: string, ids: Iterable<string>, expanded: boolean): void {
        let set = this.expanded.get(treeKey)
        if (!set) {
            set = new Set()
            this.expanded.set(treeKey, set)
        }
        let changed = false
        for (const id of ids) {
            if (expanded ? !set.has(id) : set.delete(id)) changed = true
            if (expanded) set.add(id)
        }
        if (changed) this.schedulePersist()
    }

    /** Collapses everything in a tree. */
    collapseAll(treeKey: string): void {
        if (this.expanded.get(treeKey)?.size) {
            this.expanded.delete(treeKey)
            this.schedulePersist()
        }
    }

    async setRemember(enabled: boolean): Promise<void> {
        this.remember = enabled
        await this.preferences.set(REMEMBER_TREE_EXPANSION_PREF, enabled)
        // Off: forget what was saved so turning it back on later doesn't resurrect a stale layout.
        if (enabled) this.schedulePersist()
        else await this.preferences.set(TREE_EXPANSION_PREF, {})
    }

    private schedulePersist(): void {
        if (!this.remember) return
        if (this.persistTimer) clearTimeout(this.persistTimer)
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null
            const out: Record<string, string[]> = {}
            for (const [key, set] of this.expanded) if (set.size > 0) out[key] = [...set]
            void this.preferences.set(TREE_EXPANSION_PREF, out)
        }, PERSIST_DEBOUNCE_MS)
    }
}
