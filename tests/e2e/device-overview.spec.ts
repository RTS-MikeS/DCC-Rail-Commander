/**
 * The Overview landing page: when a device is loaded the workspace opens on a
 * dashboard of how many objects each config file defines, and each card jumps
 * to its editor.
 */

import { test, expect } from './fixtures'

test.describe('device overview', () => {
    test('lands on the overview with object counts for a loaded device', async ({ workspacePage: page }) => {
        await expect(page.getByTestId('device-overview')).toBeVisible()
        await expect(page.getByTestId('nav-overview')).toBeVisible()

        // The mock project seeds a roster and turnouts, so both must be non-zero and
        // the total must be at least their sum.
        const roster = Number(await page.getByTestId('overview-count-roster').innerText())
        const turnouts = Number(await page.getByTestId('overview-count-turnouts').innerText())
        expect(roster).toBeGreaterThan(0)
        expect(turnouts).toBeGreaterThan(0)
        const total = Number(await page.getByTestId('overview-total').innerText())
        expect(total).toBeGreaterThanOrEqual(roster + turnouts)

        // Nothing seeded for sensors — shows 0 rather than being hidden.
        await expect(page.getByTestId('overview-count-sensors')).toHaveText('0')
    })

    test('clicking a card opens its editor and Overview returns to the landing page', async ({ workspacePage: page }) => {
        await page.getByTestId('overview-card-roster').click()
        await expect(page.locator('roster-editor')).toBeVisible()
        await expect(page.getByTestId('device-overview')).toHaveCount(0)

        await page.getByTestId('nav-overview').click()
        await expect(page.getByTestId('device-overview')).toBeVisible()
    })
})
