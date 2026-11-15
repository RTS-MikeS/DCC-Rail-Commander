import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { DropDownList, type PopupEventArgs } from '@syncfusion/ej2-dropdowns'
import { ALIAS_TYPE_FOLDERS, ConfigEditorState } from '../../models/config-editor-state'
import type { AliasEntry, AliasTargetType } from '../../utils/myAutomationParser'
import { allFolderPaths } from '../../utils/folder-tree'

const TYPE_OPTIONS: { text: string; value: AliasTargetType }[] = [
    { text: 'Roster', value: 'Roster' },
    { text: 'Turnout', value: 'Turnout' },
    { text: 'Sensor', value: 'Sensor' },
    { text: 'Route', value: 'Route' },
    { text: 'Sequence', value: 'Sequence' },
    { text: 'Automation', value: 'Automation' },
]

export interface AddAliasResult {
    alias: AliasEntry
}

/**
 * Modal for adding an alias by hand: which kind of object and which ID it names, the alias name,
 * and the folder it goes in. The folder follows the chosen type (see ALIAS_TYPE_FOLDERS) until the
 * user picks one themselves. Validates against the live alias list and stays open on an error.
 */
export class AddAliasDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    private readonly state = resolve(ConfigEditorState)

    typeEl!: HTMLInputElement
    idEl!: HTMLInputElement
    nameEl!: HTMLInputElement
    private sfType?: DropDownList
    private sfId?: DropDownList

    name = ''
    aliasType: AliasTargetType = 'Roster'
    targetId: number | null = null
    folder = ALIAS_TYPE_FOLDERS.Roster
    errorMessage = ''
    private folderTouched = false

    /** Existing folders plus the per-type defaults (which may not exist yet). */
    get folderOptions(): string[] {
        const all = new Set([...allFolderPaths(this.state.aliases, this.state.aliasFolders), ...Object.values(ALIAS_TYPE_FOLDERS), this.folder].filter(Boolean))
        return [...all].sort((a, b) => a.localeCompare(b))
    }

    /**
     * The dialog is a native modal <dialog> (browser top layer), which paints above anything on <body> no
     * matter its z-index — and Syncfusion parents its popups to <body>, so they'd open invisibly behind
     * the modal. Re-parent the popup into the dialog (it's position:fixed, so nothing else changes).
     */
    private hoistPopup = (args: PopupEventArgs): void => {
        const host = this.typeEl?.closest('dialog')
        const el = args.popup?.element
        if (host && el && el.parentElement !== host) host.appendChild(el)
    }

    attached(): void {
        this.sfType = new DropDownList({
            dataSource: [...TYPE_OPTIONS],
            fields: { text: 'text', value: 'value' },
            value: this.aliasType,
            open: this.hoistPopup,
            change: (args) => {
                this.aliasType = (args.value as AliasTargetType) ?? 'Roster'
                this.targetId = null
                this.errorMessage = ''
                if (!this.folderTouched) this.folder = ALIAS_TYPE_FOLDERS[this.aliasType]
                if (this.sfId) {
                    this.sfId.dataSource = this.state.getAvailableAliasTargetIds(this.aliasType)
                    this.sfId.value = null
                }
            },
        })
        this.sfType.appendTo(this.typeEl)

        this.sfId = new DropDownList({
            dataSource: this.state.getAvailableAliasTargetIds(this.aliasType),
            fields: { text: 'label', value: 'id' },
            placeholder: 'Select an ID…',
            // Refreshed right before opening: an alias added elsewhere doesn't notify this widget.
            beforeOpen: () => {
                if (this.sfId) this.sfId.dataSource = this.state.getAvailableAliasTargetIds(this.aliasType)
            },
            open: this.hoistPopup,
            change: (args) => {
                this.targetId = typeof args.value === 'number' ? args.value : null
                this.errorMessage = ''
            },
        })
        this.sfId.appendTo(this.idEl)
        this.nameEl?.focus()
    }

    detaching(): void {
        this.sfType?.destroy()
        this.sfType = undefined
        this.sfId?.destroy()
        this.sfId = undefined
    }

    onFolderChange(): void {
        this.folderTouched = true
    }

    clearError(): void {
        this.errorMessage = ''
    }

    add(): void {
        if (this.targetId == null) {
            this.errorMessage = `Select a ${this.aliasType} ID to alias.`
            return
        }
        const alias: AliasEntry = {
            name: this.name.trim(),
            value: String(this.targetId),
            aliasType: this.aliasType,
            ...(this.folder ? { folder: this.folder } : {}),
        }
        const normalized = this.state.normalizeAliases([...this.state.aliases, alias])
        if (!normalized.ok) {
            this.errorMessage = normalized.reason
            return
        }
        const result: AddAliasResult = { alias }
        void this.$dialog.ok(result)
    }

    onKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.add(); return false }
        return true
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
