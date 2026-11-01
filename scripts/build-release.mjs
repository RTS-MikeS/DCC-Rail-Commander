#!/usr/bin/env node
/**
 * One-command build: checks the Node version, installs deps (which also
 * fetches the bundled toolchain via postinstall if it isn't already present
 * for this OS/arch), builds the renderer/main bundles, packages a native
 * installer with electron-builder for whatever OS this is run on, and prints
 * the path to the resulting executable. Each run's output goes into its own
 * timestamped subfolder under release/ — old subfolders aren't cleaned up here.
 *
 *   pnpm release
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import { isChannelFile, mergeUpdateInfo } from './merge-update-info.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const log = (msg) => console.log(`[release] ${msg}`)

function run(command, args, options = {}) {
    // pnpm is a .cmd shim on Windows, which node's spawn() can only launch through a shell.
    // Folding the whole command line into one string (rather than passing shell:true alongside
    // a separate args array) avoids node's "unescaped args with shell:true" deprecation warning —
    // safe here since every arg is a fixed literal, never user input.
    return new Promise((resolve, reject) => {
        log(`${command} ${args.join(' ')}`)
        const child = spawn([command, ...args].join(' '), [], { stdio: 'inherit', cwd: ROOT, shell: true, ...options })
        child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
        )
        child.on('error', reject)
    })
}

function checkNodeVersion(requiredRange) {
    // engines.node is a simple ">=X.Y.Z" in this repo — parse the minimum major version out of it.
    const match = requiredRange.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!match) return
    const [, major] = match.map(Number)
    const actualMajor = Number(process.versions.node.split('.')[0])
    if (actualMajor < major) {
        throw new Error(
            `Node ${process.version} is too old — this project requires ${requiredRange}. ` +
                `Run \`nvm install ${major} && nvm use ${major}\` (see README.md) and try again.`,
        )
    }
    log(`Node ${process.version} OK (requires ${requiredRange})`)
}

/**
 * Finds the files electron-builder just produced that belong on the GitHub release, so the final
 * message is unambiguous: installers, their .blockmap files (used for differential update
 * downloads), and the channel file(s) the in-app updater reads.
 */
async function findReleaseArtifacts(outputDir) {
    let entries
    try {
        entries = await readdir(join(ROOT, outputDir))
    } catch {
        return []
    }
    const releaseExts = ['.exe', '.dmg', '.appimage', '.deb', '.blockmap']
    return entries.filter(
        (name) => releaseExts.includes(name.slice(name.lastIndexOf('.')).toLowerCase()) || isChannelFile(name),
    )
}

/** Parsed contents of every auto-update channel file currently in `outDir`, keyed by file name. */
async function readChannelFiles(outDir) {
    const result = {}
    for (const name of (await readdir(outDir)).filter(isChannelFile)) {
        result[name] = yaml.load(await readFile(join(outDir, name), 'utf-8'))
    }
    return result
}

/** Folds the first (x64) run's channel files into the ones the second (arm64) run just overwrote them with. */
async function mergeChannelFiles(outDir, firstRun) {
    const secondRun = await readChannelFiles(outDir)
    for (const [name, first] of Object.entries(firstRun)) {
        const merged = secondRun[name] ? mergeUpdateInfo(first, secondRun[name]) : first
        await writeFile(join(outDir, name), yaml.dump(merged, { lineWidth: -1 }))
        log(`Merged ${name}: ${merged.files.map((f) => f.url).join(', ')}`)
    }
}

/**
 * electron-builder used to package into the fixed `release/` directory (directories.output in
 * package.json's "build" config), so a second release right after a first one had to overwrite
 * the previous run's still-warm win-unpacked\resources\app.asar in place. On Windows that file
 * can briefly be held open by AV/EDR real-time scanning, the search indexer, or (when running
 * from VS Code) the editor's own file watcher/Explorer view of release/ — nothing to do with a
 * leftover app process — which turned the overwrite into an EBUSY. Deleting release/ first
 * (an earlier fix) only narrowed the window: the delete itself could still lose to one of those
 * same watchers holding a handle open, and a watcher can just as easily re-lock the freshly
 * written files a moment later. Writing every run into its own timestamped subfolder instead
 * means a run never touches another run's files at all, so this class of lock can't happen.
 */
function timestampedOutputDir() {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return join('release', stamp)
}

async function main() {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'))
    checkNodeVersion(pkg.engines.node)

    const outputDir = timestampedOutputDir()
    log(`Packaging into ${outputDir}/ (a fresh folder per run, so this build never has to overwrite a previous run's output)`)
    await run('pnpm', ['install'])
    await run('pnpm', ['build'])
    // `build.publish` in package.json is set so electron-builder writes the auto-update channel file
    // and embeds app-update.yml, but uploading is done by hand with `gh release create` (RELEASE.md).
    const outputArg = `-c.directories.output=${outputDir}`
    const publishArg = '--publish never'
    const outDir = join(ROOT, outputDir)

    if (process.platform === 'win32') {
        // electron-builder's NSIS target builds an extra "combined" installer (both archs bundled
        // into one exe, picked at install time) whenever more than one arch is requested in a single
        // invocation — see win.target's arch list in package.json. Running one invocation per arch
        // keeps each build to just its own installer, avoiding that extra ~600MB artifact.
        await run('pnpm', ['exec', 'electron-builder', '--win', '--x64', outputArg, publishArg])
        const x64ChannelFiles = await readChannelFiles(outDir)
        await run('pnpm', ['exec', 'electron-builder', '--win', '--arm64', outputArg, publishArg])
        await mergeChannelFiles(outDir, x64ChannelFiles)
    } else {
        await run('pnpm', ['exec', 'electron-builder', outputArg, publishArg])
    }

    const artifacts = await findReleaseArtifacts(outputDir)
    if (artifacts.length === 0) {
        log(`electron-builder finished, but no installer file was found under ${outputDir}/ — check the log above.`)
        return
    }
    log('Release files ready (upload all of them to the GitHub release — see RELEASE.md):')
    for (const name of artifacts) {
        log(`  ${join(outputDir, name)}`)
    }
}

main().catch((err) => {
    console.error(`[release] ${err.message}`)
    process.exit(1)
})
