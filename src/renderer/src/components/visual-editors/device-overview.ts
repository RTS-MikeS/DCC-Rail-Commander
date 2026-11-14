import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { productDetails } from '../../models/product-details'

interface OverviewCard {
    key: string
    label: string
    description: string
    count: number
    /** Folder/group count shown as a secondary stat (0 hides it). */
    folders: number
    /** Config file the card jumps to; null for Accessories (own section). */
    filename: string | null
    /** Hex color of the card's left accent bar. */
    accent: string
}

/**
 * device-overview — the landing page shown when a device is loaded. A read-only
 * dashboard of how many objects each config file defines (roster, turnouts,
 * sensors, routes, event handlers, ...). Every card jumps to its editor via the
 * existing `exinst:navigate-file` / `exinst:navigate-accessories` window events
 * that workspace.ts already listens for, so this component holds no navigation
 * logic of its own and all numbers come straight from ConfigEditorState.
 */
export class DeviceOverviewCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installer = resolve(InstallerState)

    /** Object cards only make sense for EX-CommandStation; other products have no EXRAIL objects. */
    get hasObjects(): boolean {
        return this.installer.selectedProduct === 'ex_commandstation'
    }

    get deviceName(): string {
        return this.installer.selectedDevice?.name ?? ''
    }

    /** The saved configuration's (project's) name; empty when it just repeats the device name. */
    get projectName(): string {
        const id = this.installer.activeConfigId
        const name = id ? this.installer.savedConfigurations.find((c) => c.id === id)?.name ?? '' : ''
        return name === this.deviceName ? '' : name
    }

    get productName(): string {
        const key = this.installer.selectedProduct
        return key ? (productDetails[key]?.productName ?? key) : ''
    }

    get version(): string {
        return this.installer.selectedVersion ?? ''
    }

    get cards(): OverviewCard[] {
        const s = this.state
        return [
            { key: 'roster', label: 'Roster', description: 'Locomotives', count: s.roster.length, folders: s.rosterFolders.length, filename: 'myRoster.h', accent: '#3b82f6' },
            { key: 'turnouts', label: 'Turnouts', description: 'Points & servos', count: s.turnouts.length, folders: s.turnoutFolders.length, filename: 'myTurnouts.h', accent: '#10b981' },
            { key: 'sensors', label: 'Sensors', description: 'Occupancy & inputs', count: s.sensors.length, folders: s.sensorFolders.length, filename: 'mySensors.h', accent: '#f59e0b' },
            { key: 'signals', label: 'Signals', description: 'Lineside signals', count: s.signals.length, folders: s.signalFolders.length, filename: 'mySignals.h', accent: '#f43f5e' },
            { key: 'routes', label: 'Routes', description: 'Throttle-selectable routes', count: s.routes.length, folders: s.routeFolders.length, filename: 'myRoutes.h', accent: '#8b5cf6' },
            { key: 'automations', label: 'Automations', description: 'Locomotive automations', count: s.automations.length, folders: s.automationFolders.length, filename: 'myAutomations.h', accent: '#06b6d4' },
            { key: 'sequences', label: 'Sequences', description: 'Reusable step lists', count: s.sequences.length, folders: s.sequenceFolders.length, filename: 'mySequences.h', accent: '#6366f1' },
            { key: 'events', label: 'Event handlers', description: 'ONSENSOR, ONCLOSE, ...', count: s.eventHandlers.length, folders: s.eventHandlerFolders.length, filename: 'myEvents.h', accent: '#f97316' },
            { key: 'aliases', label: 'Aliases', description: 'Named IDs', count: s.aliases.length, folders: s.aliasFolders.length, filename: 'myAliases.h', accent: '#14b8a6' },
            { key: 'accessories', label: 'Accessories', description: 'HAL devices (I2C boards)', count: s.halDevices.length, folders: 0, filename: null, accent: '#64748b' },
        ]
    }

    get totalObjects(): number {
        return this.cards.reduce((sum, c) => sum + c.count, 0)
    }

    get isEmpty(): boolean {
        return this.totalObjects === 0
    }

    open(card: OverviewCard): void {
        try {
            if (card.filename) {
                window.dispatchEvent(new CustomEvent('exinst:navigate-file', { detail: { filename: card.filename } }))
            } else {
                window.dispatchEvent(new CustomEvent('exinst:navigate-accessories'))
            }
        } catch {
            // noop in non-browser contexts
        }
    }
}
