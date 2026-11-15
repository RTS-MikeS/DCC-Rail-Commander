import { resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { confirmAction } from '../../utils/confirm-action'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { AliasEntry, AliasTargetType } from '../../utils/myAutomationParser'
import { allFolderPaths } from '../../utils/folder-tree'
import type { AddAliasResult } from '../dialogs/add-alias-dialog'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

export class AliasesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    rawEditor: any = null
    errorMessage = ''
    private lastValidAliases: AliasEntry[] = []

    private cloneAliases(aliases: AliasEntry[]): AliasEntry[] {
        return aliases.map(alias => ({ ...alias }))
    }

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        this._ensureSelection()
        try { console.debug('AliasesEditor attached') } catch { /* ignore */ }
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    setTab(t: 'visual' | 'raw') {
        this._userChoseTab = true
        this._applyTab(t)
    }

    /** Applies the current default-editor-view preference, unless the user has already picked a tab for this file this session. Called from attached() on every visit — see there for why. */
    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    /** setTab()'s actual work, factored out so attached() can (re)apply the default-editor-view preference without marking it as a user choice. */
    private _applyTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.aliasesRaw
        this.activeTab = t
        if (t === 'visual') this._ensureSelection()
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        const result = this.state.setAliasesFromRaw(text)
        if (result.ok) {
            this.errorMessage = ''
            this.lastValidAliases = this.cloneAliases(this.state.aliases)
        } else {
            this.errorMessage = result.reason
        }
    }

    // ── Add alias (modal) ──────────────────────────────────────────────────
    /** Opens the Add Alias modal; the alias it returns is committed and selected here. */
    openAddDialog = async (): Promise<void> => {
        const { dialog } = await this.dialogService.open({
            component: () => import('../dialogs/add-alias-dialog').then(m => m.AddAliasDialog).catch(() => null),
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return
        this.addAlias((result.value as AddAliasResult).alias)
    }

    private addAlias(candidate: AliasEntry): void {
        const normalized = this.state.normalizeAliases([...this.state.aliases, candidate])
        if (!normalized.ok) {
            this.errorMessage = normalized.reason
            return
        }
        this.errorMessage = ''
        this.state.aliases = normalized.aliases
        this.state.syncAll()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
        this.selectedFolder = ''
        this.selectedIndex = this.state.aliases.findIndex(a => a.name === candidate.name)
    }

    async removeAlias(idx: number) {
        const entry = this.state.aliases[idx]
        if (!entry) return
        if (!(await confirmAction(this.dialogService, `Delete "${entry.name}"?`, 'Are you sure you want to remove this alias?'))) return
        this.state.aliases = this.state.aliases.filter((_, i) => i !== idx)
        this.state.syncAll()
        this.errorMessage = ''
        this._ensureSelection()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    updateAlias(idx: number, a: AliasEntry) {
        const nextAliases = this.state.aliases.map((v, i) => i === idx ? { ...a } : v)
        const normalized = this.state.normalizeAliases(nextAliases)
        if (!normalized.ok) {
            this.errorMessage = normalized.reason
            this.state.aliases = this.cloneAliases(this.lastValidAliases)
            return
        }
        this.errorMessage = ''
        this.state.aliases = normalized.aliases
        this.state.syncAll()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    commitAlias(idx: number): void {
        const alias = this.state.aliases[idx]
        if (!alias) return
        this.updateAlias(idx, alias)
    }

    getAliasTypeLabel(alias: AliasEntry): string {
        return this.state.getAliasTypeLabel(alias)
    }

    // -- Folders (organizing only: never changes the ALIAS lines, their values or the sort-order setting) --
    /** Folder selected in the tree ('' = none); new aliases are created inside it. */
    selectedFolder = ''
    /** Index into state.aliases of the alias being edited, or -1. The right pane shows only this one. */
    selectedIndex = -1

    get selectedIndices(): number[] {
        return this.selectedIndex >= 0 && this.selectedIndex < this.state.aliases.length ? [this.selectedIndex] : []
    }

    get folderPaths(): string[] {
        return allFolderPaths(this.state.aliases, this.state.aliasFolders)
    }

    itemLabel = (item: AliasEntry): string => item.name
    addFolder = (path: string): boolean => this.state.addFolderTo('aliases', path)
    renameFolder = (from: string, to: string): boolean => this.state.renameFolderIn('aliases', from, to)
    removeFolder = (path: string): void => this.state.deleteFolderFrom('aliases', path)
    moveToFolder = (idx: number, folder: string): void => this.state.moveToFolder('aliases', idx, folder)

    /** Keeps the right pane useful: pick the first top-level alias when nothing valid is selected. */
    private _ensureSelection(): void {
        if (this.selectedFolder) return
        if (this.selectedIndex < 0 || this.selectedIndex >= this.state.aliases.length) {
            // Only a top-level entry: opening one inside a folder would expand that folder in the tree.
            this.selectedIndex = this.state.aliases.findIndex(x => !x.folder)
        }
    }

    /** Aliases grouped by type and ordered per the alias sort-order setting — see ConfigEditorState.groupedAliases. Each item keeps its index into state.aliases so edit/remove handlers can target it directly. */
    get groupedAliases(): { label: string; items: { alias: AliasEntry; index: number }[] }[] {
        return this.state.groupedAliases
    }
}
