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

// Kill electron.exe processes whose ExecutablePath sits inside THIS
// repo's node_modules. Naive `taskkill /IM electron.exe /T` would kill
// every Electron-based dev tool the developer has open (VS Code, Slack,
// Discord, another local Electron project) — the postmortem for that
// mistake is nobody's idea of a good time.
function killByRepoOwnedName(name) {
    if (process.platform !== 'win32') return;
    // Use CIM/WMI to filter by ExecutablePath — Get-Process doesn't
    // expose Path from a Filter query cleanly. Escape single quotes and
    // backslashes for the inline PowerShell.
    const repoRoot = process.cwd().replace(/'/g, "''");
    // Match anything with our repo path AND \node_modules\electron\ in it.
    const cmd = [
        'powershell', '-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='${name}'" ` +
        `| Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${repoRoot}\\') } ` +
        `| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Output ("killed pid " + $_.ProcessId) } catch {} }`
    ].join(' ');
    try {
        const out = execSync(cmd, { stdio: 'pipe' }).toString().trim();
        if (out) log(`${name}: ${out}`);
    } catch {
        // Non-zero exit = filter matched nothing, or the PS invocation
        // itself failed. Either way we can't proceed with a broader kill.
    }
}

function killPortHolder(port) {
    if (process.platform !== 'win32') return;
    try {
        // netstat -ano prints one line per socket. We anchor on
        // LISTENING <pid> at the end of the line so we don't match
        // sub-string ports (":121380" is not port 12138). Extract the
        // pid safely with a boundary regex.
        const out = execSync(`netstat -ano -p tcp`, { stdio: 'pipe' }).toString();
        const pids = new Set();
        const lineRx = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`);
        for (const line of out.split('\n')) {
            const m = line.match(lineRx);
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

log('killing THIS repo\'s electron / dev-server processes before rebuild...');
killByRepoOwnedName('electron.exe');
killByRepoOwnedName('GeekEZ Browser.exe');
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
