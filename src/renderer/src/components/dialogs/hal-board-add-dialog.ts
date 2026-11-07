import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { getHalBoard, type HalBoardDefinition } from '../../config/hal-boards'
import type { HalDeviceInstance } from '../../config/hal-devices'

export interface HalBoardAddModel {
    boardId: string
    /** Boards already declared — used for the live address/channel conflict check and the multiplexer list. */
    existing: HalDeviceInstance[]
}

export interface HalBoardAddResult {
    label: string
    address: number
    parentMuxInstanceId?: string
    muxChannel?: number
}

function formatHex(n: number): string {
    return '0x' + n.toString(16).padStart(2, '0')
}

/**
 * Modal shown by the Accessories tab's "Add Board" button. Collects the name, I2C address and, when
 * multiplexers exist, which one the board sits behind and on which channel, then creates the board
 * on "Create". The "already in use" warning is a getter over the current field values, so it
 * disappears the moment the user picks a free address/channel (never a one-shot message set on submit).
 */
export class HalBoardAddDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    board!: HalBoardDefinition
    existing: HalDeviceInstance[] = []
    label = ''
    address = 0
    addressText = ''
    parentMuxInstanceId = ''
    muxChannel = 0

    activate(model: HalBoardAddModel): void {
        this.board = getHalBoard(model.boardId)!
        this.existing = model.existing
        this.label = this.board.label
        this.address = this.board.defaultAddress
        this.addressText = formatHex(this.address)
    }

    get multiplexers(): HalDeviceInstance[] {
        return this.existing.filter(d => getHalBoard(d.boardId)?.isMultiplexer)
    }

    get canUseMux(): boolean {
        return !this.board.isMultiplexer && this.multiplexers.length > 0
    }

    get channelOptions(): number[] {
        if (!this.parentMuxInstanceId) return []
        const parent = this.existing.find(d => d.instanceId === this.parentMuxInstanceId)
        const count = parent ? getHalBoard(parent.boardId)?.muxChannelCount ?? 0 : 0
        return Array.from({ length: count }, (_, i) => i)
    }

    /** Parsed free-entry address, or null when out of range / unparsable. */
    private get parsedFreeAddress(): number | null {
        const range = this.board.addressRange
        if (!range) return null
        const n = parseInt(this.addressText, 16)
        return !isNaN(n) && n >= range[0] && n <= range[1] ? n : null
    }

    get effectiveAddress(): number {
        return this.board.addressMode === 'free-entry' ? this.parsedFreeAddress ?? this.address : this.address
    }

    get addressInvalid(): boolean {
        return this.board.addressMode === 'free-entry' && this.parsedFreeAddress === null
    }

    formatAddress(n: number): string {
        return formatHex(n)
    }

    /** True if another board shares this address on the same bus segment (same mux + channel). */
    get addressInUse(): boolean {
        const mux = this.parentMuxInstanceId || undefined
        const channel = mux ? Number(this.muxChannel) : undefined
        return this.existing.some(
            d =>
                d.address === this.effectiveAddress &&
                (d.parentMuxInstanceId || undefined) === mux &&
                d.muxChannel === channel,
        )
    }

    onMuxChange(): void {
        this.muxChannel = 0
    }

    ok(): void {
        if (this.addressInvalid) return
        const mux = this.parentMuxInstanceId || undefined
        const result: HalBoardAddResult = {
            label: this.label.trim() || this.board.label,
            address: this.effectiveAddress,
            parentMuxInstanceId: mux,
            muxChannel: mux ? Number(this.muxChannel) : undefined,
        }
        void this.$dialog.ok(result)
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
