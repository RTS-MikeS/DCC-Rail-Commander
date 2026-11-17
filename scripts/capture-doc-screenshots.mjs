// One-off dev tool: launches the app (mock mode, same harness as tests/e2e/fixtures.ts) and
// captures real screenshots for docs/assets/screenshots/, used by the MkDocs user guide under docs/.
// Not part of the test suite — run manually: `pnpm docs:shots` (runs `pnpm build` first), or
// `node scripts/capture-doc-screenshots.mjs [--only=wizard|workspace]` against an existing build.
//
// The workspace shots use a COPY of the maintainer's real saved project ("M&W Railroad") as seed data, read
// from the installed app's preferences file (override with DOCS_SEED_PREFS=<path>, or pick another saved
// project with DOCS_SEED_NAME=<substring>). The real app data is only ever read, never written. The WiFi
// settings in config.h are replaced with made-up values before the copy is used, and the run aborts if the
// real SSID/password still appear anywhere in the seed — these images are published on the public docs site.
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { tmpdir, homedir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const ELECTRON_MAIN = join(REPO_ROOT, 'out/main/index.js')
const SHOT_DIR = join(REPO_ROOT, 'docs/assets/screenshots')
mkdirSync(SHOT_DIR, { recursive: true })

const { ELECTRON_RUN_AS_NODE: _ern, ...ELECTRON_ENV } = process.env

const failures = []

async function shot(page, name) {
    try {
        await page.waitForTimeout(250)
        await page.evaluate(() => {
            // Clicking down the nav leaves the sidebar scrolled; show it from the top.
            document.querySelectorAll('*').forEach((el) => {
                if (el.scrollTop > 0 && el.getBoundingClientRect().left < 50 && el.getBoundingClientRect().width < 400) el.scrollTop = 0
            })
        }).catch(() => undefined)
        await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) })
        console.log(`  ✓ ${name}.png`)
    } catch (err) {
        failures.push(name)
        console.log(`  ✗ ${name}.png — ${err.message.split('\n')[0]}`)
    }
}

async function step(label, fn) {
    try {
        await fn()
    } catch (err) {
        console.log(`  ! ${label} failed: ${err.message.split('\n').slice(0, 12).join(' | ').slice(0, 1800)}`)
        failures.push(`(step) ${label}`)
    }
}

/** Best-effort temp cleanup: Windows often holds a lock on Electron's profile dir for a moment after exit. */
function cleanup(dir) {
    try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (err) {
        console.log(`  (could not delete ${dir}: ${err.code ?? err.message})`)
    }
}

function launchArgs(testDataDir) {
    return [
        ELECTRON_MAIN,
        '--mock-device',
        '--mock-upload',
        '--skip-startup',
        `--test-data-dir=${testDataDir}`,
        '--disable-gpu',
        '--no-sandbox',
        '--offscreen',
        '--js-flags=--no-expose-wasm',
    ]
}

async function cleanDialog(page) {
    page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => {
        document.querySelectorAll('[id^="ej2-licensing"]').forEach((el) => el.remove())
    }).catch(() => undefined)
}

// ── Seed content: a sanitized copy of the maintainer's real project ──

const FAKE_WIFI = { WIFI_HOSTNAME: 'dccex', WIFI_SSID: 'MyRailroadWiFi', WIFI_PASSWORD: 'changeme123' }

const MOCK_SKETCH_INO = [
    '// CommandStation-EX.ino — minimal mock sketch',
    '#include "config.h"',
    '',
    'void setup() {}',
    'void loop() {}',
    '',
].join('\n')

function seedPrefsPath() {
    if (process.env.DOCS_SEED_PREFS) return process.env.DOCS_SEED_PREFS
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'dcc-rail-commander-electron', 'app-preferences', 'dcc-rail-commander-preferences.json')
}

/** Reads the real saved project (read-only) and returns it with config.h's WiFi values replaced. */
function loadSeedProject() {
    const path = seedPrefsPath()
    if (!existsSync(path)) throw new Error(`Seed preferences not found: ${path} (set DOCS_SEED_PREFS)`)
    const wanted = process.env.DOCS_SEED_NAME ?? 'M&W'
    const saved = JSON.parse(readFileSync(path, 'utf-8')).savedConfigurations ?? []
    const project = saved.find((c) => String(c.name).includes(wanted))
    if (!project) throw new Error(`No saved project whose name contains "${wanted}" in ${path}`)

    // Pull the real WiFi values out of config.h, then overwrite them with the fakes.
    const real = {}
    const configFiles = project.configFiles.map((f) => {
        if (f.name !== 'config.h') return f
        const content = f.content.replace(/^(\s*#define\s+)(WIFI_HOSTNAME|WIFI_SSID|WIFI_PASSWORD)(\s+)"([^"]*)"/gm, (_m, pre, key, sp, value) => {
            real[key] = value
            return `${pre}${key}${sp}"${FAKE_WIFI[key]}"`
        })
        return { ...f, content }
    })

    // Safety net: none of the real values may survive anywhere in the seed.
    for (const [key, value] of Object.entries(real)) {
        if (value.length >= 3 && key !== 'WIFI_HOSTNAME' && configFiles.some((f) => f.content.includes(value))) {
            throw new Error(`Real ${key} still present in the seed copy — refusing to capture.`)
        }
    }
    if (real.WIFI_SSID === undefined) console.log('  ! no WIFI_SSID found in config.h — nothing to scrub')
    return { project, configFiles }
}

function seedWorkspace() {
    const { project, configFiles } = loadSeedProject()
    const testDataDir = mkdtempSync(join(tmpdir(), 'dcc-rc-docshots-'))
    const scratchPath = join(testDataDir, 'scratch', 'CommandStation-EX')
    mkdirSync(scratchPath, { recursive: true })
    for (const { name, content } of configFiles) writeFileSync(join(scratchPath, name), content, 'utf-8')
    writeFileSync(join(scratchPath, 'CommandStation-EX.ino'), MOCK_SKETCH_INO, 'utf-8')

    const prefsDir = join(testDataDir, 'app-preferences')
    mkdirSync(prefsDir, { recursive: true })
    const savedConfig = {
        id: 'docshots-config',
        name: 'Docs Layout',
        deviceName: 'EX-CSB1',
        devicePort: '/dev/ttyACM0',
        deviceFqbn: project.deviceFqbn,
        deviceSerialNumber: 'DCCEX-CSB1-0001',
        product: project.product,
        productName: project.productName,
        version: project.version,
        repoPath: join(testDataDir, 'scratch'),
        scratchPath,
        // No sourceFolder: Save must never write back into the maintainer's real project folder.
        configFiles,
        lastModified: new Date().toISOString(),
    }
    writeFileSync(
        join(prefsDir, 'dcc-rail-commander-preferences.json'),
        JSON.stringify({ savedConfigurations: [savedConfig] }, null, 2),
        'utf-8',
    )
    return testDataDir
}

/**
 * Selects one entry in the current tree editor, so the right-hand pane shows a real form instead of the
 * empty "Select an entry to edit" placeholder. Works for both tree kinds: the Syncfusion tree (roster,
 * turnouts) and the shared folder-tree-panel (everything else). `text` picks a specific entry.
 */
async function selectEntry(page, text) {
    const sf = page.locator('.e-treeview li.e-list-item').filter({ hasText: text ?? /./ }).filter({ hasNot: page.locator('[data-uid^="folder:"]') })
    const panel = page.locator('[data-testid="tree-item"]').filter({ hasText: text ?? /./ })
    if (await panel.count() > 0) await panel.first().click()
    else if (await sf.count() > 0) await sf.first().locator('.e-fullrow').first().click()
    await page.waitForTimeout(400)
}

/** Opens every folder in the current tree editor (no-op if the toggle already reads "Collapse all"). */
async function expandTree(page) {
    const toggle = page.locator('[data-testid="tree-toggle-all"][title="Expand all"]').first()
    if (await toggle.count() > 0) {
        await toggle.click()
        await page.waitForTimeout(400)
    }
}

// ── Phase 1: onboarding + wizard ────────────────────────────────────────────────

async function captureOnboardingAndWizard() {
    console.log('\n== Onboarding + New Device Wizard ==')
    const testDataDir = mkdtempSync(join(tmpdir(), 'dcc-rc-docshots-onb-'))
    const app = await electron.launch({ args: launchArgs(testDataDir), chromiumSandbox: false, env: ELECTRON_ENV })
    try {
        const page = await app.firstWindow()
        await cleanDialog(page)
        await page.waitForSelector('text=New Device', { timeout: 15_000 })
        await shot(page, 'home-onboarding')

        await page.getByText('New Device', { exact: true }).click()
        await page.waitForSelector('text=Setup New Device', { timeout: 10_000 })
        await page.waitForTimeout(1500) // let device scan settle

        // ── Step 0: Select Device ──
        await step('select CSB1 board', async () => {
            const csb1 = page.locator('button', { hasText: /CSB1/i }).first()
            if (await csb1.count() > 0) await csb1.click()
            else await page.locator('div[if\\.bind] button').first().click().catch(() => undefined)
        })
        await shot(page, 'wizard-select-device')

        // ── Step 1: Select Version ──
        await step('advance to Select Version', async () => {
            await page.getByRole('button', { name: 'Next' }).click()
            // Wait for version list (network fetch of tags) — generous timeout.
            await page.waitForFunction(
                () => {
                    const sel = document.querySelector('select')
                    return sel && sel.querySelectorAll('option').length > 0
                },
                { timeout: 45_000 },
            ).catch(() => undefined)
            await page.waitForTimeout(300)
        })
        await shot(page, 'wizard-select-version')

        // ── Step 2: WiFi ──
        await step('advance to WiFi', async () => {
            await page.getByRole('button', { name: 'Next' }).click()
            await page.waitForSelector('text=Set up WiFi', { timeout: 5000 })
            await page.waitForTimeout(300)
        })
        await shot(page, 'wizard-wifi')

        // ── Step 3: Hardware ──
        await step('advance to Hardware', async () => {
            await page.getByRole('button', { name: 'Next' }).click()
            await page.waitForSelector('text=Hardware settings', { timeout: 5000 })
            await page.waitForTimeout(300)
        })
        await shot(page, 'wizard-hardware')

        // ── Step 4: Track Power ──
        await step('advance to Track Power', async () => {
            await page.getByRole('button', { name: 'Next' }).click()
            await page.waitForSelector('track-manager-form', { timeout: 5000 })
            await page.waitForTimeout(500)
        })
        await shot(page, 'wizard-track-power')

        // ── Step 5: Confirm ──
        await step('advance to Confirm', async () => {
            await page.getByRole('button', { name: 'Next' }).click()
            await page.waitForSelector('text=Review your selections', { timeout: 10_000 })
            await page.waitForTimeout(300)
        })
        await shot(page, 'wizard-confirm')
    } finally {
        await app.close().catch(() => undefined)
        cleanup(testDataDir)
    }
}

// ── Phase 2: workspace (everything else) ────────────────────────────────────────

async function captureWorkspace() {
    console.log('\n== Workspace ==')
    const testDataDir = seedWorkspace()
    const app = await electron.launch({ args: launchArgs(testDataDir), chromiumSandbox: false, env: ELECTRON_ENV })
    try {
        const page = await app.firstWindow()
        await cleanDialog(page)
        await page.waitForSelector('text=Docs Layout', { timeout: 15_000 })
        await shot(page, 'home-recent-devices')

        await page.getByText('Docs Layout').click()
        await page.waitForSelector('text=Roster', { timeout: 15_000 })
        await page.waitForTimeout(1000)
        await shot(page, 'workspace-overview')

        // ── Roster ──
        await step('Roster', async () => {
            await page.getByText('Roster', { exact: true }).first().click()
            await page.waitForSelector('[data-testid="tree-toggle-all"]', { timeout: 10_000 })
            await expandTree(page)
            await selectEntry(page, 'Penn Central')
        })
        await shot(page, 'roster-editor')

        // ── Turnouts + add-turnout dialog flow ──
        await step('Turnouts', async () => {
            await page.getByText('Turnouts', { exact: true }).first().click()
            await page.waitForTimeout(300)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'turnout-editor')

        await step('New Turnout kind picker', async () => {
            await page.getByTitle('Add new turnout').click()
            await page.waitForSelector('text=New Turnout', { timeout: 5000 })
        })
        await shot(page, 'turnout-new-kind-picker')

        await step('Select Pin dialog', async () => {
            await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
            await page.waitForSelector('text=Select Pin', { timeout: 5000 })
        })
        await shot(page, 'turnout-select-pin')

        await step('Calibrate Servo dialog', async () => {
            await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
            await page.waitForSelector('text=Calibrate Servo', { timeout: 5000 })
        })
        await shot(page, 'turnout-servo-calibration')

        await step('close turnout dialog', async () => {
            const cancelBtn = page.getByRole('dialog').getByRole('button', { name: 'Cancel' })
            if (await cancelBtn.count() > 0) await cancelBtn.click()
        })

        // ── Sensors ──
        await step('Sensors', async () => {
            await page.getByText('Sensors', { exact: true }).first().click()
            await page.waitForTimeout(300)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'sensors-editor')

        // ── Signals ──
        await step('Signals', async () => {
            await page.getByText('Signals', { exact: true }).first().click()
            await page.waitForTimeout(300)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'signals-editor')

        // ── Routes (Blocks then Raw) ──
        await step('Routes Blocks', async () => {
            await page.getByText('Routes', { exact: true }).first().click()
            await page.waitForSelector('.blocklySvg', { timeout: 10_000 })
            await page.waitForTimeout(500)
            await expandTree(page)
        })
        await shot(page, 'routes-editor-blocks')

        await step('Routes Raw', async () => {
            await page.getByTestId('row-tab-raw').click()
            await page.waitForTimeout(300)
        })
        await shot(page, 'routes-editor-raw')

        // ── Sequences ──
        await step('Sequences', async () => {
            await page.getByText('Sequences', { exact: true }).first().click()
            await page.waitForTimeout(500)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'sequences-editor')

        // ── Automations ──
        await step('Automations', async () => {
            await page.getByText('Automations', { exact: true }).first().click()
            await page.waitForTimeout(500)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'automations-editor')

        // ── Event Handlers ──
        await step('Event Handlers', async () => {
            await page.getByText('Event Handlers', { exact: true }).first().click()
            await page.waitForTimeout(500)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'event-handlers-editor')

        // ── Aliases ──
        await step('Aliases', async () => {
            await page.getByText('Aliases', { exact: true }).first().click()
            await page.waitForTimeout(500)
            await expandTree(page)
            await selectEntry(page)
        })
        await shot(page, 'aliases-editor')

        await step('Add Alias dialog', async () => {
            await page.getByTitle('Add alias').click()
            await page.waitForSelector('[data-testid="add-alias-dialog"]', { timeout: 5000 })
            await page.waitForTimeout(300)
        })
        await shot(page, 'aliases-add-dialog')

        await step('close Add Alias dialog', async () => {
            await page.getByTestId('add-alias-dialog').getByRole('button', { name: 'Cancel' }).click()
            await page.waitForTimeout(300)
        })

        // ── Device Settings: General + WiFi ──
        await step('General + WiFi', async () => {
            await page.getByTestId('nav-general-wifi').click()
            await page.waitForTimeout(500)
        })
        await shot(page, 'general-wifi-editor')

        // ── Device Settings: Accessories (add one HAL board first) ──
        await step('Accessories', async () => {
            await page.getByTestId('nav-accessories').click()
            await page.waitForSelector('hal-devices-form', { timeout: 10_000 })
            await page.waitForTimeout(500)
        })
        await shot(page, 'accessories-hal-editor')

        // ── Device Settings: Startup ──
        await step('Startup', async () => {
            await page.getByTestId('nav-startup').click()
            await page.waitForTimeout(500)
        })
        await shot(page, 'startup-editor')

        // ── Device Settings: Advanced ──
        await step('Advanced', async () => {
            await page.getByTestId('nav-advanced').click()
            await page.waitForTimeout(500)
        })
        await shot(page, 'advanced-editor')

        // ── Compile (Output panel) ──
        await step('Compile', async () => {
            await page.locator('button:has-text("Compile")').first().click()
            // Real PlatformIO build: wait for it to finish so the Output panel shows the result and later
            // shots don't catch a half-compiled "Compiling…" header button.
            await page.waitForFunction(
                () => ![...document.querySelectorAll('button')].some((b) => /compiling/i.test(b.textContent ?? '')),
                undefined,
                { timeout: 240_000 },
            )
            await page.waitForTimeout(800)
        })
        await shot(page, 'compile-output')

        // ── Connect (for Throttle + Monitor) ──
        await step('Connect', async () => {
            // The seed project auto-connects (Preferences → Auto-connect); only click if it hasn't yet.
            const toggle = page.getByTestId('connect-toggle')
            if (!/disconnect/i.test((await toggle.textContent()) ?? '')) await toggle.click()
            await page.waitForTimeout(2000)
        })

        // ── Throttle ── (default Add mode is "Roster" — type into the roster combo and pick Thomas)
        await step('Throttle: acquire a loco', async () => {
            await page.getByTestId('throttle-nav-item').click()
            await page.waitForSelector('[data-testid="throttle-panel-root"]', { timeout: 10_000 })
            // Same approach as tests/e2e/throttle.spec.ts: click the Syncfusion `.e-ddl` wrapper (the real
            // <input> inside it is covered by the wrapper), then click the item in the popup list.
            await page.locator('.e-ddl', { has: page.getByTestId('throttle-roster-select') }).click()
            await page.waitForTimeout(300)
            await page.locator('li.e-list-item', { hasText: 'Thomas' }).first().click()
            await page.waitForTimeout(300)
            await page.getByTestId('throttle-add').click()
            await page.waitForTimeout(1000)
        })
        await shot(page, 'throttle-panel')

        // ── Serial Monitor ──
        await step('Monitor', async () => {
            await page.locator('button:has-text("Monitor")').first().click()
            await page.waitForTimeout(1500)
        })
        await shot(page, 'serial-monitor')

        // ── Preferences ──
        await step('Preferences', async () => {
            await page.getByTestId('settings-button').click()
            await page.waitForTimeout(500)
        })
        await shot(page, 'preferences-dialog')

        await step('Preferences (lower sections)', async () => {
            await page.getByTestId('settings-remember-tree-expansion').last().scrollIntoViewIfNeeded()
            await page.evaluate(() => {
                const dlg = document.querySelector('dialog') ?? document.body
                dlg.querySelectorAll('*').forEach((el) => {
                    if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight
                })
            })
            await page.waitForTimeout(300)
        })
        await shot(page, 'preferences-dialog-lower')
    } finally {
        await app.close().catch(() => undefined)
        cleanup(testDataDir)
    }
}

async function main() {
    const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
    if (!only || only === 'wizard') await captureOnboardingAndWizard()
    if (!only || only === 'workspace') await captureWorkspace()

    console.log('\n== Done ==')
    if (failures.length > 0) {
        console.log(`${failures.length} screenshot(s)/step(s) had problems:`)
        for (const f of failures) console.log(`  - ${f}`)
        process.exitCode = 1
    } else {
        console.log('All screenshots captured cleanly.')
    }
}

main()
