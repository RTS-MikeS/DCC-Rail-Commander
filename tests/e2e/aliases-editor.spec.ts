/**
 * E2E tests: Aliases editor — grouping by inferred/declared alias type and
 * alphabetical sorting by alias name within each group, plus the new-alias
 * form's Type -> ID dropdown pair (the ID picker only ever offers real
 * object IDs, and drops an ID once it already has an alias of that type,
 * enforcing one alias per ID).
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Aliases Editor"
 */

import { test, expect, answerConfirmDialog } from './fixtures'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openAliasesEditor(page: import('@playwright/test').Page) {
    await page.getByText('Aliases', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function switchToRaw(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(400)
}

async function switchToVisual(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Visual' }).click()
}

async function setMonacoContent(page: import('@playwright/test').Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(500)
}

function treeItems(page: import('@playwright/test').Page) {
    return page.locator('aliases-editor [data-testid="tree-item"]')
}

function aliasRows(page: import('@playwright/test').Page) {
    return page.locator('aliases-editor [data-testid="alias-row"]')
}

function nameInputs(page: import('@playwright/test').Page) {
    return aliasRows(page).locator('input[placeholder="NAME"]')
}

/** Opens an SF DropDownList by the data-testid on its underlying input, then picks an option by its visible text. Same pattern as pickFromDropdown() in throttle.spec.ts (including the settle waits — clicking the popup item too early on its open/close animation makes the click a no-op). */
async function selectSfDropdown(page: import('@playwright/test').Page, inputTestId: string, optionText: string) {
    await page.locator('.e-ddl', { has: page.getByTestId(inputTestId) }).click()
    await page.waitForTimeout(200)
    await page.locator('li.e-list-item', { hasText: optionText }).first().click()
    await page.waitForTimeout(200)
}

/** Opens the Add Alias modal from the tree header's + button. */
async function openAddAliasDialog(page: import('@playwright/test').Page) {
    await page.locator('aliases-editor').getByTitle('Add alias').click()
    await page.getByTestId('add-alias-dialog').waitFor({ state: 'visible', timeout: 5_000 })
}

/** Fills and submits the Add Alias modal: Name text input, Type dropdown, ID dropdown (labelled by the target object's name/description), then Add Alias. */
async function addAlias(page: import('@playwright/test').Page, name: string, type: string, idLabel: string) {
    await openAddAliasDialog(page)
    const dialog = page.getByTestId('add-alias-dialog')
    await dialog.locator('input[placeholder="NAME"]').fill(name)
    await selectSfDropdown(page, 'new-alias-type', type)
    await selectSfDropdown(page, 'new-alias-id', idLabel)
    await dialog.getByRole('button', { name: 'Add Alias' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
}

// workspacePage seeds two turnouts (ids 200/201) and roster locos 3/5 — used
// below as the "real" object IDs aliases must reference.

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Aliases Editor', () => {
    test('lists every alias as a tree leaf and the right pane edits only the selected one', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(ZEBRA_TURNOUT, 200) // type: Turnout',
            'ALIAS(APPLE_TURNOUT, 201) // type: Turnout',
            'ALIAS(LOCO_ALIAS, 3)',
        ].join('\n'))
        await switchToVisual(page)

        await expect(page.getByText('3 entries')).toBeVisible()
        await expect(treeItems(page)).toHaveCount(3)
        // One card at a time: the first alias is auto-selected.
        await expect(aliasRows(page)).toHaveCount(1)

        await treeItems(page).filter({ hasText: 'APPLE_TURNOUT' }).click()
        await expect(aliasRows(page)).toHaveCount(1)
        await expect(nameInputs(page).first()).toHaveValue('APPLE_TURNOUT')
        await expect(aliasRows(page).first()).toContainText('Turnout')

        await treeItems(page).filter({ hasText: 'LOCO_ALIAS' }).click()
        await expect(nameInputs(page).first()).toHaveValue('LOCO_ALIAS')
        // No declared type: inferred from the roster loco the value matches.
        await expect(aliasRows(page).first()).toContainText('Roster')
    })

    test('renaming an alias updates its tree label', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(MIDDLE, 200) // type: Turnout',
            'ALIAS(ALPHA, 201) // type: Turnout',
        ].join('\n'))
        await switchToVisual(page)

        await treeItems(page).filter({ hasText: 'ALPHA' }).click()
        await nameInputs(page).first().fill('ZULU')
        await nameInputs(page).first().blur()

        await expect(treeItems(page).filter({ hasText: 'ZULU' })).toHaveCount(1)
        await expect(treeItems(page).filter({ hasText: 'ALPHA' })).toHaveCount(0)
    })

    test('removing the selected alias drops it from the tree', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            'ALIAS(ONLY_TURNOUT, 200) // type: Turnout',
            'ALIAS(ONLY_ROSTER, 3)',
        ].join('\n'))
        await switchToVisual(page)
        await expect(treeItems(page)).toHaveCount(2)

        await treeItems(page).filter({ hasText: 'ONLY_ROSTER' }).click()
        // Cancelling the confirm dialog must leave both aliases in place.
        await aliasRows(page).first().locator('button[title="Delete"]').click()
        await answerConfirmDialog(page, 'cancel')
        await expect(treeItems(page)).toHaveCount(2)

        await aliasRows(page).first().locator('button[title="Delete"]').click()
        await answerConfirmDialog(page, 'confirm')
        await expect(treeItems(page)).toHaveCount(1)
        await expect(treeItems(page).first()).toContainText('ONLY_TURNOUT')
    })

    // ── Folders: organizing only, stored as // @tree: comments ────────────────

    test('moving an alias into a folder is written as // @tree: above its ALIAS line and survives a raw round-trip', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            '// @tree-folder: Spare',
            '// @tree: Yard',
            'ALIAS(YARD_SW, 200) // type: Turnout',
            'ALIAS(MAIN_SW, 201) // type: Turnout',
        ].join('\n'))
        await switchToVisual(page)

        // The folder from the file shows up in the tree with its alias inside.
        await expect(page.locator('aliases-editor [data-testid="folder-row"]', { hasText: 'Yard' })).toBeVisible()
        await expect(page.locator('aliases-editor [data-testid="folder-row"]', { hasText: 'Spare' })).toBeVisible()

        // Move MAIN_SW into Spare with the card's Folder dropdown.
        await treeItems(page).filter({ hasText: 'MAIN_SW' }).click()
        await page.locator('aliases-editor [data-testid="alias-folder"]').selectOption('Spare')

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('@tree: Spare')
        await expect(page.locator('div.monaco-editor')).toContainText('@tree: Yard')
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(MAIN_SW, 201)')
    })

    test('foldered aliases stay collapsed: nothing opens or gets selected inside a folder on its own', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await switchToRaw(page)
        await setMonacoContent(page, [
            '// @tree: Turnouts',
            'ALIAS(JUNCTION_A, 200) // type: Turnout',
            '// @tree: Roster',
            'ALIAS(THOMAS, 3) // type: Roster',
        ].join('\n'))
        await switchToVisual(page)

        await expect(page.locator('aliases-editor [data-testid="folder-row"]')).toHaveCount(2)
        await expect(treeItems(page)).toHaveCount(0)
        await expect(aliasRows(page)).toHaveCount(0)
        // Folders list alphabetically.
        await expect(page.locator('aliases-editor [data-testid="folder-row"]').first()).toContainText('Roster')

        // The toggle opens everything; the entries inside are alphabetical too.
        await page.getByTestId('tree-toggle-all').click()
        await expect(treeItems(page)).toHaveText([/THOMAS/, /JUNCTION_A/])
    })

    // ── Type -> ID dropdown: only real object IDs are offered, one alias per ID ─

    test('the ID picker only offers real object IDs, labelled by name/description', async ({ workspacePage: page }) => {
        // workspacePage seeds turnouts 200 ("Main Line Junction") and 201 ("Yard Entry").
        await openAliasesEditor(page)
        await openAddAliasDialog(page)
        await selectSfDropdown(page, 'new-alias-type', 'Turnout')
        await page.locator('.e-ddl', { has: page.getByTestId('new-alias-id') }).click()

        await expect(page.locator('li.e-list-item', { hasText: 'Main Line Junction' })).toBeVisible()
        await expect(page.locator('li.e-list-item', { hasText: 'Yard Entry' })).toBeVisible()
    })

    test('clicking Add Alias without selecting an ID is rejected with an error and not saved', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await openAddAliasDialog(page)
        const dialog = page.getByTestId('add-alias-dialog')
        await dialog.locator('input[placeholder="NAME"]').fill('MY_ALIAS')
        await dialog.getByRole('button', { name: 'Add Alias' }).click()

        // The modal stays open and says what's missing.
        await expect(dialog.getByText(/Select a Roster ID/)).toBeVisible()
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(page.getByText('0 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).not.toContainText('MY_ALIAS')
    })

    test('selecting a type and ID and adding saves the alias successfully', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await addAlias(page, 'GOOD_TARGET', 'Turnout', 'Main Line Junction')

        await expect(page.getByText('1 entries')).toBeVisible()

        await switchToRaw(page)
        await expect(page.locator('div.monaco-editor')).toContainText('ALIAS(GOOD_TARGET, 200)')
    })

    test('an object ID that already has an alias is not offered again for the same type', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await addAlias(page, 'FIRST_JUNCTION', 'Turnout', 'Main Line Junction')
        await expect(page.getByText('1 entries')).toBeVisible()

        await openAddAliasDialog(page)
        await page.getByTestId('add-alias-dialog').locator('input[placeholder="NAME"]').fill('SECOND_JUNCTION')
        await selectSfDropdown(page, 'new-alias-type', 'Turnout')
        await page.locator('.e-ddl', { has: page.getByTestId('new-alias-id') }).click()

        // "Main Line Junction" (turnout 200) is already aliased — only one alias per ID.
        await expect(page.locator('li.e-list-item', { hasText: 'Main Line Junction' })).toHaveCount(0)
        await expect(page.locator('li.e-list-item', { hasText: 'Yard Entry' })).toBeVisible()
    })

    test('a manually added alias is filed under its type folder by default, and the folder can be changed in the modal', async ({ workspacePage: page }) => {
        await openAliasesEditor(page)
        await openAddAliasDialog(page)
        const dialog = page.getByTestId('add-alias-dialog')
        await dialog.locator('input[placeholder="NAME"]').fill('JUNCTION_A')
        await selectSfDropdown(page, 'new-alias-type', 'Turnout')
        await expect(dialog.getByTestId('new-alias-folder')).toHaveValue('Turnouts')
        await selectSfDropdown(page, 'new-alias-id', 'Main Line Junction')
        await dialog.getByRole('button', { name: 'Add Alias' }).click()
        await dialog.waitFor({ state: 'hidden', timeout: 5_000 })

        await addAliasInFolder(page, 'YARD_B', 'Yard Entry', '')

        await switchToRaw(page)
        const raw = page.locator('div.monaco-editor')
        await expect(raw).toContainText('@tree: Turnouts')
        await expect(raw).toContainText('ALIAS(JUNCTION_A, 200)')
        await expect(raw).toContainText('ALIAS(YARD_B, 201)')
    })
})

/** Adds a Turnout alias, overriding the modal's folder choice ('' = no folder). */
async function addAliasInFolder(page: import('@playwright/test').Page, name: string, idLabel: string, folder: string) {
    await openAddAliasDialog(page)
    const dialog = page.getByTestId('add-alias-dialog')
    await dialog.locator('input[placeholder="NAME"]').fill(name)
    await selectSfDropdown(page, 'new-alias-type', 'Turnout')
    await selectSfDropdown(page, 'new-alias-id', idLabel)
    await dialog.getByTestId('new-alias-folder').selectOption(folder)
    await dialog.getByRole('button', { name: 'Add Alias' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
}
