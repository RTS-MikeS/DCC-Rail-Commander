/**
 * "Open last device on startup" — on launch the app jumps straight into the device that was last
 * open in the workspace (preference `lastOpenedConfigId`), unless `reopenLastDevice` is turned off.
 * The seeded saved configuration (id `e2e-test-config`) is the same one every fixture app uses.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { test as base, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanupDir, launchMockUpdateApp } from './fixtures'

interface Fixtures {
    launched: { app: ElectronApplication; testDataDir: string }
    page: Page
}

const test = base.extend<Fixtures & { preferences: Record<string, unknown> }>({
    preferences: [{}, { option: true }],
    launched: async ({ preferences }, use) => {
        // Updates off so the mock update dialog never gets in the way.
        const launched = await launchMockUpdateApp({ autoCheckForUpdates: false, ...preferences })
        await use(launched)
        await launched.app.close()
        cleanupDir(launched.testDataDir)
    },
    page: async ({ launched }, use) => {
        const page = await launched.app.firstWindow()
        page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
        await page.waitForLoadState('domcontentloaded')
        await page.evaluate(() => {
            document.querySelectorAll('[id^="ej2-licensing"]').forEach((el) => el.remove())
        }).catch(() => undefined)
        await use(page)
    },
})

function readPreferences(testDataDir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(testDataDir, 'app-preferences', 'dcc-rail-commander-preferences.json'), 'utf-8'))
}

test.describe('open last device on startup', () => {
    test.describe('enabled by default', () => {
        test.use({ preferences: { lastOpenedConfigId: 'e2e-test-config' } })

        test('launches straight into the last-used device', async ({ page }) => {
            await expect(page.getByText('Roster', { exact: true })).toBeVisible({ timeout: 20_000 })
            await expect(page.getByText('Recent Devices')).toHaveCount(0)
        })

        test('the Settings toggle is on and can be turned off', async ({ page, launched }) => {
            await expect(page.getByText('Roster', { exact: true })).toBeVisible({ timeout: 20_000 })
            await page.getByTestId('settings-button').click()
            const toggle = page.getByTestId('settings-reopen-last-device')
            await expect(toggle).toBeChecked()
            await toggle.uncheck({ force: true })
            await expect.poll(() => readPreferences(launched.testDataDir).reopenLastDevice).toBe(false)
        })
    })

    test.describe('turned off', () => {
        test.use({ preferences: { lastOpenedConfigId: 'e2e-test-config', reopenLastDevice: false } })

        test('stays on the home screen', async ({ page }) => {
            await expect(page.getByText('E2E Test Layout')).toBeVisible({ timeout: 20_000 })
            await expect(page.getByText('Roster', { exact: true })).toHaveCount(0)
        })
    })

    test.describe('no remembered device', () => {
        test('stays on the home screen', async ({ page }) => {
            await expect(page.getByText('E2E Test Layout')).toBeVisible({ timeout: 20_000 })
        })
    })

    test.describe('remembered device was removed', () => {
        test.use({ preferences: { lastOpenedConfigId: 'does-not-exist' } })

        test('falls back to the home screen', async ({ page }) => {
            await expect(page.getByText('E2E Test Layout')).toBeVisible({ timeout: 20_000 })
        })
    })
})
