#!/usr/bin/env node
// prebuild:win / prebuild:mac / prebuild:linux hook.
//
// electron-builder rebuilds native modules (better-sqlite3) against the
// packaged Electron target. On Windows the rebuild fails with EPERM if
// any electron.exe process still has better_sqlite3.node mmap'd —
// classic "another process is using this file" lock. Common cause:
// `npm run dev` was left running and its main-process still holds the
// module.
//
// This script kills any lingering electron / packaged-app processes
// before the build starts. Safe: it targets the app by name, doesn't
// touch unrelated processes.
//
// Also frees ports 12138 (API server) and 15173 (vite dev server) so a
// subsequent `npm run dev` doesn't collide.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function log(...s) { console.log('[prebuild-cleanup]', ...s); }

function killByName(name) {
    if (process.platform !== 'win32') return;
    try {
        execSync(`taskkill /F /IM "${name}" /T`, { stdio: 'pipe' });
        log(`killed ${name}`);
    } catch {
        // Non-zero exit = no such process — that's fine.
    }
}

function killPortHolder(port) {
    if (process.platform !== 'win32') return;
    try {
        // Get PID owning the port from netstat output.
        const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { stdio: 'pipe' }).toString();
        const pids = new Set();
        for (const line of out.split('\n')) {
            const m = line.match(/LISTENING\s+(\d+)/);
            if (m) pids.add(m[1]);
        }
        for (const pid of pids) {
            try {
                execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'pipe' });
                log(`killed pid ${pid} holding port ${port}`);
            } catch { /* already gone */ }
        }
    } catch {
        // No listener — nothing to do.
    }
}

log('killing electron / dev-server processes before rebuild...');
killByName('electron.exe');
killByName('GeekEZ Browser.exe');
killPortHolder(12138);
killPortHolder(15173);

// Give the OS a beat to actually release the .node file handle.
await new Promise(r => setTimeout(r, 1500));

// Sanity check: is the .node file writable now?
const target = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
if (existsSync(target)) {
    try {
        // Try to touch (open+close for RW). If this succeeds, the file
        // isn't locked and the build's rebuild step will succeed.
        const { openSync, closeSync } = await import('node:fs');
        const fd = openSync(target, 'r+');
        closeSync(fd);
        log('better-sqlite3 .node is unlocked — ready to rebuild');
    } catch (e) {
        log(`WARNING: better-sqlite3 .node still locked (${e.code || e.message}).`);
        log('If build:win errors with EPERM, close any editor/explorer preview of the .node file and retry.');
    }
}
