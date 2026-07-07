// IPC bridge between the renderer and src/main/kernel/manager.js.
// Extracted from src/main/index.js (2025-07) purely for readability —
// the seven kernel:* handlers plus the in-flight install token are a
// self-contained cluster that only needs profileDB and activeProcesses
// from the parent.
//
// The launch handler in index.js also consults `getActiveInstall()` to
// piggy-back on an in-flight download instead of starting a second one
// for the same version.

const { ipcMain, BrowserWindow } = require('electron');
const kernelManager = require('./manager');

// Token for the current install: { controller, promise, version } or null.
// Kept module-local — nobody outside this file should mutate it, but the
// launch flow reads it via getActiveInstall() to await the same promise.
let activeInstall = null;

function getActiveInstall() {
    return activeInstall;
}

function emitProgress(payload) {
    const windows = BrowserWindow.getAllWindows();
    for (const w of windows) {
        try {
            if (!w || w.isDestroyed() || !w.webContents || w.webContents.isDestroyed()) continue;
            w.webContents.send('kernel:progress', payload);
        } catch (_) { /* window gone mid-broadcast — nothing to do */ }
    }
}

// Wrap an install run with the shared activeInstall token, the progress
// broadcast, and error → phase='error' translation. Returns the raw
// install result on success or throws on failure.
//
// Uses a deferred promise so we can register activeInstall BEFORE the
// IIFE starts — otherwise a synchronous throw from kernelManager.
// installVersion runs the finally { activeInstall = null } before the
// outer assignment, and we permanently write a stale rejected-promise
// token to activeInstall, blocking every future install (SEV-1 fix).
function runInstall(version, extraFields = {}) {
    const controller = new AbortController();
    let installResolve, installReject;
    const installPromise = new Promise((res, rej) => { installResolve = res; installReject = rej; });
    activeInstall = { controller, promise: installPromise, version };
    (async () => {
        try {
            const result = await kernelManager.installVersion(version, {
                signal: controller.signal,
                onProgress: (p) => emitProgress({ version, ...p })
            });
            emitProgress({ version, phase: 'done', execPath: result.execPath, ...extraFields });
            installResolve({ ...result, ...extraFields });
        } catch (e) {
            emitProgress({ version, phase: 'error', message: e.message });
            installReject(e);
        } finally {
            activeInstall = null;
        }
    })();
    return installPromise;
}

// Same pattern for the ensure path (checkInstalled + installVersion) —
// gets bundled-copy short-circuit for free.
function runEnsureInstall(version) {
    const controller = new AbortController();
    let installResolve, installReject;
    const installPromise = new Promise((res, rej) => { installResolve = res; installReject = rej; });
    activeInstall = { controller, promise: installPromise, version };
    (async () => {
        try {
            const result = await kernelManager.ensureInstalled(version, {
                signal: controller.signal,
                onProgress: (p) => emitProgress({ version, ...p })
            });
            emitProgress({ version, phase: 'done', execPath: result.execPath, source: result.source });
            installResolve(result);
        } catch (e) {
            emitProgress({ version, phase: 'error', message: e.message });
            installReject(e);
        } finally {
            activeInstall = null;
        }
    })();
    return installPromise;
}

function registerKernelIpc({ profileDB, getActiveProcesses, getLaunchingProfiles }) {
    ipcMain.handle('kernel:get-status', async () => {
        try {
            const status = await kernelManager.checkInstalled(kernelManager.PINNED_VERSION);
            return {
                installed: !!status.installed,
                execPath: status.execPath || null,
                version: kernelManager.PINNED_VERSION,
                downloading: !!activeInstall
            };
        } catch (e) {
            return { installed: false, error: e.message, version: kernelManager.PINNED_VERSION, downloading: !!activeInstall };
        }
    });

    // Ensure the pinned version is installed. Uses ensureInstalled (which
    // is checkInstalled + installVersion) so a bundled copy is picked up
    // for free without a download.
    //
    // Piggy-back is version-scoped (SEV-1 fix): if activeInstall exists
    // for a DIFFERENT version, we wait for that install to finish (to
    // serialize disk writes into the kernels dir) then start our own.
    // The old code returned the wrong-version install's result and the
    // caller believed our version was installed when it wasn't.
    ipcMain.handle('kernel:ensure', async () => {
        const wantedVersion = kernelManager.PINNED_VERSION;
        if (activeInstall && activeInstall.version === wantedVersion) {
            try {
                const result = await activeInstall.promise;
                return { ok: true, ...result };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
        if (activeInstall) {
            // Different-version install in flight. Wait for it (ignore
            // its result — we care about our own) then run ours.
            try { await activeInstall.promise; } catch { /* other install's failure isn't our concern */ }
        }
        try {
            const result = await runEnsureInstall(wantedVersion);
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('kernel:cancel', async () => {
        if (!activeInstall) return { cancelled: false, reason: 'no active install' };
        try { activeInstall.controller.abort(); } catch (_) { /* already aborted */ }
        return { cancelled: true };
    });

    ipcMain.handle('kernel:list-installed', async (_e, opts = {}) => {
        try {
            const installed = await kernelManager.listInstalled({ measureSize: !!opts.measureSize });
            return { ok: true, pinned: kernelManager.PINNED_VERSION, installed };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('kernel:list-available', async (_e, opts = {}) => {
        try {
            const available = await kernelManager.listAvailable({ force: !!opts.force });
            return { ok: true, available };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('kernel:install-version', async (_e, version) => {
        if (!version || !/^\d+\.\d+\.\d+\.\d+$/.test(String(version))) {
            return { ok: false, error: 'invalid version' };
        }
        // Piggy-back only on same-version installs (SEV-1 fix); wait for
        // different-version installs to finish before starting our own.
        if (activeInstall && activeInstall.version === version) {
            try {
                const result = await activeInstall.promise;
                return { ok: true, ...result };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
        if (activeInstall) {
            try { await activeInstall.promise; } catch { /* other version's failure isn't our concern */ }
        }
        try {
            const result = await runInstall(version, { installed: true, source: 'downloaded' });
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('kernel:uninstall-version', async (_e, version) => {
        if (!version || version === kernelManager.PINNED_VERSION) {
            return { ok: false, error: 'cannot uninstall pinned version' };
        }
        // Refuse if a running OR *launching* profile uses this kernel
        // (T7 fix). Old code only checked activeProcesses — a launch that
        // had already resolved kernelPath but hadn't yet spawned Chrome
        // was invisible. Uninstall could rip the install dir out from
        // under it. Now we also consult launchingProfiles.
        try {
            const activeProcesses = getActiveProcesses ? getActiveProcesses() : {};
            const launchingProfiles = getLaunchingProfiles ? getLaunchingProfiles() : new Set();
            const idsToCheck = new Set([
                ...Object.keys(activeProcesses),
                ...Array.from(launchingProfiles)
            ]);
            if (idsToCheck.size > 0) {
                const conflicts = [];
                for (const id of idsToCheck) {
                    const p = await profileDB.getById(id);
                    if (p && p.kernelVersion === version) {
                        conflicts.push(p.name || id);
                    }
                }
                if (conflicts.length > 0) {
                    return {
                        ok: false,
                        error: `kernel is used by running or launching profile(s): ${conflicts.join(', ')}`
                    };
                }
            }
        } catch (_) { /* soft-check; if profileDB is unavailable, fall through */ }

        try {
            const result = await kernelManager.uninstallVersion(version);
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });
}

module.exports = {
    registerKernelIpc,
    getActiveInstall,
    // Used by the launch flow to broadcast progress for its ad-hoc
    // install (bypasses the activeInstall token — pre-existing behavior
    // predating this refactor).
    emitKernelProgress: emitProgress
};
