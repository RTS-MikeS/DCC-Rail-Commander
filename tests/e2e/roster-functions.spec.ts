/**
 * E2E tests: Roster editor function list (clear-on-delete, edit no-function slot,
 * up/down reorder) and tree scrolling.
 */
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function openRoster(page: Page) {
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
}

async function selectLoco(page: Page, name: string) {
    await page.locator('#roster-treeview li').filter({ hasText: name }).first().locator('.e-fullrow').click()
}

async function rawText(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
    await page.waitForTimeout(500)
    const t = await page.evaluate(() =>
        Array.from(document.querySelectorAll('div.monaco-editor .view-line'))
            .map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n'))
    await page.getByRole('button', { name: 'Visual' }).click()
    await expect(page.locator('#roster-treeview')).toBeVisible()
    return t
}

const fnRows = (page: Page) => page.locator('div[draggable="true"]').filter({ has: page.locator('input[type="checkbox"]') })

test.describe('Roster function list', () => {
    test('deleting a function clears the slot instead of shifting; slot is editable; arrows reorder', async ({ workspacePage: page }) => {
        await openRoster(page)
        await selectLoco(page, 'Thomas') // LIGHT/HORN/*WHISTLE/BELL

        // Strict aliases (default) blocks commits for alias-less locos
        const alias = page.locator('div:has(> label:has-text("Alias")) input[type="text"]').first()
        await alias.fill('THOMAS_ALIAS')
        await alias.blur()

        // Delete F1 (HORN)
        await fnRows(page).nth(1).getByTitle('Remove').click()
        await page.getByTestId('confirm-dialog').getByRole('button').last().click()
        await expect(fnRows(page).nth(1).locator('input[type="text"]')).toHaveValue('')
        expect(await rawText(page)).toContain('"LIGHT//*WHISTLE/BELL"')

        // Edit the cleared slot
        await selectLoco(page, 'Thomas')
        const input = fnRows(page).nth(1).locator('input[type="text"]')
        await expect(input).toBeEnabled()
        await input.fill('SMOKE')
        await input.blur()
        expect(await rawText(page)).toContain('"LIGHT/SMOKE/*WHISTLE/BELL"')

        // Move F0 down
        await selectLoco(page, 'Thomas')
        await fnRows(page).nth(0).getByTitle('Move down').click()
        expect(await rawText(page)).toContain('"SMOKE/LIGHT/*WHISTLE/BELL"')

        // Move F3 up
        await selectLoco(page, 'Thomas')
        await fnRows(page).nth(3).getByTitle('Move up').click()
        expect(await rawText(page)).toContain('"SMOKE/LIGHT/BELL/*WHISTLE"')
    })

    test('roster tree scrolls when it has many entries', async ({ workspacePage: page }) => {
        await openRoster(page)
        await page.getByRole('button', { name: 'Raw' }).click()
        await expect(page.locator('div.monaco-editor')).toBeVisible()
        const lines = Array.from({ length: 60 }, (_, i) => `ROSTER(${100 + i}, "Loco ${i}", "LIGHT")`)
        await page.locator('div.monaco-editor').first().click()
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Delete')
        await page.evaluate(() => navigator.clipboard?.writeText?.('')) // no-op safeguard
        for (let i = 0; i < lines.length; i++) {
            await page.keyboard.type(lines[i])
            if (i < lines.length - 1) await page.keyboard.press('Enter')
        }
        await page.waitForTimeout(600)
        await page.getByRole('button', { name: 'Visual' }).click()
        await expect(page.locator('#roster-treeview')).toBeVisible()

        const nav = page.locator('nav[aria-label="Roster"]')
        const m = await nav.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, ov: getComputedStyle(el).overflowY }))
        expect(m.ov).toBe('auto')
        expect(m.sh).toBeGreaterThan(m.ch)
        await nav.evaluate(el => { el.scrollTop = el.scrollHeight })
        expect(await nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
        await expect(page.locator('#roster-treeview li').filter({ hasText: 'Loco 59' }).first()).toBeInViewport()
    })
})
