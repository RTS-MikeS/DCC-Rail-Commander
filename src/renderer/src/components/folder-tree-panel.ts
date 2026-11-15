import { bindable, resolve, INode } from 'aurelia'
import { loadTreeWidth, saveTreeWidth } from '../utils/tree-width'
import { IDialogService } from '@aurelia/dialog'
import { buildFolderTree, isValidFolderName, itemIndicesUnder, type FolderItem, type FolderTreeNode } from '../utils/folder-tree'
import { confirmAction } from '../utils/confirm-action'
import { ToastService } from '../services/toast.service'
import { TreeExpansionService } from '../services/tree-expansion.service'
import type { TextInputResult } from './dialogs/text-input-dialog'

interface TreeRow {
    kind: 'folder' | 'item'
    key: string
    depth: number
    label: string
    /** Folder path (folders) or the item's own folder (items). */
    path: string
    /** Index into `items` (items) — -1 for folders. */
    index: number
    count: number
    open: boolean
}

/**
 * Left-hand navigator shared by the list editors (sensors, signals, routes, ...): a tree of folders
 * with the entries as leaves. Selecting a leaf sets `selectedIndex` (the editor shows just that
 * entry in its right pane); selecting a folder sets `selectedFolder` and clears the index. Folders
 * are purely logical grouping — the panel never touches the entries' EXRAIL macros. Entries can be
 * dragged onto a folder (or the "All" root row) to move them.
 *
 * The editor owns the data: it passes `items` (anything with an optional `folder`), `folders`
 * (declared, possibly empty), `itemLabel`, and add/rename/remove/move callbacks.
 */
export class FolderTreePanelCustomElement {
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)

    @bindable items: FolderItem[] = []
    @bindable folders: string[] = []
    @bindable({ mode: 'twoWay' }) selectedFolder = ''
    @bindable({ mode: 'twoWay' }) selectedIndex = -1
    /** Embedded inside a Syncfusion Splitter pane (routes/sequences/automations): the splitter owns the width, so no resize handle of our own. */
    @bindable embedded = false
    /** When set, a blue "+" button (with this title) calls `onAddItem` — for editors whose Add button lives in the tree header. */
    @bindable addTitle = ''
    @bindable onAddItem?: () => void
    /** When set, each leaf gets a × button that calls it (the editor confirms and deletes). */
    @bindable onRemoveItem?: (index: number, event: Event) => void
    /** Called when a leaf is selected, for editors that track their selection themselves (by id). */
    @bindable onSelectItem?: (index: number) => void
    /** Returns true to show the "no alias" warning dot on a leaf. */
    @bindable itemWarn?: (item: FolderItem, index: number) => boolean
    @bindable label = 'Items'
    @bindable itemLabel: (item: FolderItem, index: number) => string = (_i, n) => `#${n + 1}`
    @bindable onAdd!: (path: string) => boolean
    @bindable onRename!: (from: string, to: string) => boolean
    @bindable onRemove!: (path: string) => void
    @bindable onMove!: (index: number, folder: string) => void

    width = 256
    private static readonly MIN_WIDTH = 200
    private static readonly MAX_WIDTH = 600

    attached(): void {
        try {
            this.width = this._clamp(loadTreeWidth())
        } catch { /* storage unavailable — keep the default */ }
    }

    private _clamp(w: number): number {
        return Math.min(FolderTreePanelCustomElement.MAX_WIDTH, Math.max(FolderTreePanelCustomElement.MIN_WIDTH, w))
    }

    /** Drag handle on the panel's right edge. */
    startResize(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLElement
        const startX = event.clientX
        const startWidth = this.width
        handle.setPointerCapture(event.pointerId)
        const move = (e: PointerEvent): void => { this.width = this._clamp(startWidth + e.clientX - startX) }
        const up = (): void => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', up)
            handle.removeEventListener('pointercancel', up)
            saveTreeWidth(this.width)
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', up)
        handle.addEventListener('pointercancel', up)
    }

    private readonly treeExpansion = resolve(TreeExpansionService)
    /** Entries are listed alphabetically by their label. */
    private readonly _labelOf = (index: number): string => this.itemLabel(this.items[index], index)
    private readonly host = resolve(INode) as HTMLElement

    /** Folder paths currently expanded (everything starts collapsed). Mirrored into TreeExpansionService, keyed by `label`, so it survives editor switches and (per the setting) launches. Reassigned, never mutated, so the `rows` getter re-evaluates. */
    expanded: string[] = []
    private _dragIndex = -1

    binding(): void {
        // The shared host-sizing rule makes custom elements grow to fill their flex parent, which would
        // give this panel half the row (and push the editor pane away from it). Standalone, it keeps its
        // own width; embedded in a Splitter pane it still fills the pane.
        if (!this.embedded) {
            this.host.style.flex = '0 0 auto'
            this.host.style.width = 'auto'
        }
        this.expanded = this.treeExpansion.expandedIds(this.label)
        if (this.selectedIndex >= 0) this._reveal(this.items[this.selectedIndex]?.folder ?? '', true)
        else this._reveal(this.selectedFolder, false)
    }

    /** Opens `path`'s ancestors (and `path` itself when `includeSelf`) so a just-selected entry isn't hidden inside a collapsed folder. */
    private _reveal(path: string, includeSelf: boolean): void {
        if (!path) return
        const parts = path.split('/')
        const toOpen: string[] = []
        for (let i = 1; i <= parts.length - (includeSelf ? 0 : 1); i++) {
            const p = parts.slice(0, i).join('/')
            if (!this.expanded.includes(p)) toOpen.push(p)
        }
        if (toOpen.length === 0) return
        this.expanded = [...this.expanded, ...toOpen]
        this.treeExpansion.setMany(this.label, toOpen, true)
    }

    selectedIndexChanged(index: number): void {
        if (index >= 0) this._reveal(this.items[index]?.folder ?? '', true)
    }

    selectedFolderChanged(path: string): void {
        this._reveal(path, false)
    }

    /** True while any folder is open — drives the header toggle's icon. */
    get hasExpanded(): boolean {
        return this.rows.some(r => r.kind === 'folder' && r.open)
    }

    toggleAll(): void {
        if (this.hasExpanded) this.collapseAll()
        else this.expandAll()
    }

    private expandAll(): void {
        const paths: string[] = []
        const walk = (nodes: FolderTreeNode[]): void => {
            for (const n of nodes) {
                if (n.kind !== 'folder') continue
                paths.push(n.path)
                walk(n.children)
            }
        }
        walk(buildFolderTree(this.items, this.folders, this._labelOf))
        this.expanded = paths
        this.treeExpansion.setMany(this.label, paths, true)
    }

    private collapseAll(): void {
        this.expanded = []
        this.treeExpansion.collapseAll(this.label)
    }

    get rows(): TreeRow[] {
        const out: TreeRow[] = []
        const walk = (nodes: FolderTreeNode[], depth: number): void => {
            for (const n of nodes) {
                if (n.kind === 'folder') {
                    const open = this.expanded.includes(n.path)
                    out.push({ kind: 'folder', key: `f:${n.path}`, depth, label: n.name, path: n.path, index: -1, count: itemIndicesUnder(this.items, n.path).length, open })
                    if (open) walk(n.children, depth + 1)
                } else {
                    const item = this.items[n.index]
                    out.push({ kind: 'item', key: `i:${n.index}`, depth, label: this.itemLabel(item, n.index), path: item.folder ?? '', index: n.index, count: 0, open: false })
                }
            }
        }
        walk(buildFolderTree(this.items, this.folders, this._labelOf), 0)
        return out
    }

    selectFolder(path: string): void {
        this.selectedIndex = -1
        this.selectedFolder = path
    }

    selectItem(index: number): void {
        this.selectedIndex = index
        this.selectedFolder = ''
        this.onSelectItem?.(index)
    }

    warn(row: TreeRow): boolean {
        return row.kind === 'item' && !!this.itemWarn && this.itemWarn(this.items[row.index], row.index)
    }

    remove(row: TreeRow, event: Event): void {
        event.stopPropagation()
        this.onRemoveItem?.(row.index, event)
    }

    toggle(path: string): void {
        const open = !this.expanded.includes(path)
        this.expanded = open ? [...this.expanded, path] : this.expanded.filter(p => p !== path)
        this.treeExpansion.setExpanded(this.label, path, open)
    }

    isSelected(row: TreeRow): boolean {
        return row.kind === 'folder' ? this.selectedIndex < 0 && this.selectedFolder === row.path : this.selectedIndex === row.index
    }

    /** Where "New folder" goes: inside the selected folder, or beside the selected entry. */
    private get _container(): string {
        if (this.selectedIndex >= 0) return this.items[this.selectedIndex]?.folder ?? ''
        return this.selectedFolder
    }

    // ── Drag & drop (entries onto folders) ────────────────────────────────────
    /** Folder path currently highlighted as the drop destination ('' = top level), or null. */
    dropTarget: string | null = null

    dragStart(event: DragEvent, row: TreeRow): void {
        if (row.kind !== 'item') return
        this._dragIndex = row.index
        event.dataTransfer?.setData('text/plain', String(row.index))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    }

    dragOver(event: DragEvent, folder: string): void {
        if (this._dragIndex < 0) return
        event.preventDefault()
        // Only the innermost row handles it, so the nav's top-level highlight doesn't override a folder's.
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        this.dropTarget = folder
    }

    dragLeave(event: DragEvent): void {
        const nav = event.currentTarget as HTMLElement
        if (!nav.contains(event.relatedTarget as Node | null)) this.dropTarget = null
    }

    /** Fires on the dragged row even when the drop lands outside any target (Esc, outside the panel). */
    dragEnd(): void {
        this._dragIndex = -1
        this.dropTarget = null
    }

    drop(event: DragEvent, folder: string): void {
        event.stopPropagation()
        event.preventDefault()
        const index = this._dragIndex
        this._dragIndex = -1
        this.dropTarget = null
        if (index < 0) return
        this.onMove(index, folder)
        this.selectItem(index)
    }

    private async _prompt(title: string, label: string, value: string, confirmLabel: string, validate: (v: string) => string): Promise<string | null> {
        const { dialog } = await this.dialogService.open({
            component: () => import('./dialogs/text-input-dialog').then(m => m.TextInputDialog).catch(() => null),
            model: { title, label, value, confirmLabel, validate },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as TextInputResult).value
    }

    private _validateName = (v: string): string => (isValidFolderName(v) ? '' : 'Folder names can\'t be blank or contain "/".')

    /** New folder inside the selected folder (or at the top level when "All" is selected). */
    async promptNewFolder(): Promise<void> {
        const name = await this._prompt('New Folder', 'Folder name', '', 'Create', this._validateName)
        if (name === null) return
        const container = this._container
        const path = container ? `${container}/${name}` : name
        if (!this.onAdd(path)) {
            this.toastService.show({ title: "Can't Create Folder", content: `A folder named "${path}" already exists.`, cssClass: 'e-toast-warning' })
            return
        }
        this.selectFolder(path)
    }

    async promptRename(): Promise<void> {
        const from = this.selectedFolder
        if (!from) return
        const current = from.split('/').pop() ?? from
        const name = await this._prompt('Rename Folder', 'Folder name', current, 'Rename', this._validateName)
        if (name === null || name === current) return
        const parent = from.split('/').slice(0, -1).join('/')
        const to = parent ? `${parent}/${name}` : name
        if (!this.onRename(from, to)) {
            this.toastService.show({ title: "Can't Rename Folder", content: `A folder named "${to}" already exists.`, cssClass: 'e-toast-warning' })
            return
        }
        this.selectFolder(to)
    }

    async confirmDelete(): Promise<void> {
        const path = this.selectedFolder
        if (!path) return
        if (!(await confirmAction(this.dialogService, `Delete folder "${path}"?`, `Its ${this.label.toLowerCase()} and subfolders move up one level — nothing else is deleted.`, { confirmLabel: 'Delete folder' }))) return
        this.onRemove(path)
        this.selectFolder(path.split('/').slice(0, -1).join('/'))
    }
}
