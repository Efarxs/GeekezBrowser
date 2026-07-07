#!/usr/bin/env node
// Guard against a common footgun: after `npm run build:win` (or the
// mac/linux equivalents), electron-builder rebuilds better-sqlite3
// for the *packaged* Electron target — and because the Windows config
// packages both x64 AND arm64, the last binary produced may be the
// arm64 one, which then can't load in a local x64 dev run. `npm run
// dev` then crashes with:
//   "better_sqlite3.node is not a valid Win32 application"
//
// This script runs as `predev` (fast — @electron/rebuild is
// idempotent when the binary already matches the current Electron
// version + arch) and as `postbuild:*` (proactively restores the
// dev-friendly binary right after packaging).
//
// Use `--check` to only report status without rebuilding.
// Use `--restore` for the post-package variant (identical behavior,
// separate flag purely for logging clarity).

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODULE = 'better-sqlite3';
const args = process.argv.slice(2);
const isRestore = args.includes('--restore');
const checkOnly = args.includes('--check');

function log(...s) {
    console.log('[ensure-native-abi]', ...s);
}

// Cheap heuristic — try loading better-sqlite3 as if we were the
// Electron main process. If it throws "is not a valid Win32
// application" or "invalid ELF header" or similar, we know the ABI /
// arch is wrong and we need a rebuild. If it loads clean, we skip.
async function needsRebuild() {
    try {
        // Dynamic import so a failing require doesn't kill this script.
        // Node itself can load the .node file (they share ABI numbers
        // for a given Node major); we're actually testing that the
        // arch matches. On mismatch, `require` throws synchronously.
        const modPath = join(process.cwd(), 'node_modules', MODULE);
        if (!existsSync(modPath)) {
            log(`${MODULE} not installed — skipping (postinstall will handle it)`);
            return false;
        }
        // Use `createRequire` to load in CJS mode. We swallow the
        // module's own version check; we only care whether the .node
        // file dlopens.
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        require(modPath);
        return false;
    } catch (e) {
        const msg = String(e?.message || e);
        if (/not a valid Win32 application|invalid ELF|dlopen|Symbol not found|arch/i.test(msg)) {
            log(`ABI mismatch detected: ${msg.split('\n')[0]}`);
            return true;
        }
        // Other error — could be a legit runtime error. Try rebuild
        // anyway; worst case is one extra ~5s call.
        log(`unknown load error (${msg.split('\n')[0]}) — rebuilding to be safe`);
        return true;
    }
}

async function runRebuild() {
    log(`rebuilding ${MODULE} for local Electron ABI...`);
    return new Promise((resolve, reject) => {
        // Node on Windows can't spawn `.cmd` shims without `shell: true`
        // (returns EINVAL). No injection concern here — args are fixed
        // constants defined at the top of the file.
        const isWin = process.platform === 'win32';
        const child = spawn('npx', ['@electron/rebuild', '-f', '-w', MODULE], {
            stdio: 'inherit',
            shell: isWin
        });
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`rebuild exit ${code}`)));
        child.on('error', reject);
    });
}

(async () => {
    if (isRestore) {
        log('post-package restore: forcing rebuild against local Electron');
        await runRebuild();
        log('done');
        process.exit(0);
    }
    const rebuild = await needsRebuild();
    if (checkOnly) {
        log(rebuild ? 'REBUILD NEEDED' : 'ABI ok');
        process.exit(rebuild ? 1 : 0);
    }
    if (!rebuild) {
        log('ABI ok — skipping rebuild');
        process.exit(0);
    }
    await runRebuild();
    log('done');
})().catch(e => {
    console.error('[ensure-native-abi] failed:', e);
    // Don't block dev on this — the underlying error will surface
    // more clearly when electron actually tries to load the module.
    process.exit(0);
});
