import { resolve } from 'aurelia'
import { UpdaterService } from '../services/updater.service'

/**
 * Header button that appears whenever an app update is available, downloading or ready to install
 * (the VS Code / Discord "Update" pill). Clicking it opens the update dialog, which owns the
 * release notes and the download → restart flow.
 */
export class UpdateButtonCustomElement {
    readonly updater = resolve(UpdaterService)

    get visible(): boolean {
        const status = this.updater.state.status
        return status === 'available' || status === 'downloading' || status === 'downloaded'
    }

    get ready(): boolean {
        return this.updater.state.status === 'downloaded'
    }

    get label(): string {
        const state = this.updater.state
        switch (state.status) {
            case 'downloading':
                return `Updating ${Math.round(state.percent)}%`
            case 'downloaded':
                return 'Restart to update'
            default:
                return 'Update available'
        }
    }

    get tooltip(): string {
        const state = this.updater.state
        const version = 'update' in state && state.update ? state.update.version : ''
        return this.ready ? `Version ${version} is ready — restart to install` : `Version ${version} — view release notes`
    }

    open(): void {
        void this.updater.showUpdateDialog()
    }
}
