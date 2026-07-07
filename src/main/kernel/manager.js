// Kernel install manager: check / migrate / download / extract / verify.
//
// Storage layout (mirrors setup.js's bundled shape so chromium-path.js works
// against either without special-casing):
//
//   <installRoot>/<version>/
//     chrome/
//       fingerprint-chromium/
//         VERSION
//         ungoogled-chromium_<version>-1.1_<platform>/  chrome(.exe)
//
// installRoot defaults to `<userData>/kernels/fingerprint-chromium`.

const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { downloadChunked } = require('./downloader');

// Pinned kernel version — bumped alongside GeekEZ releases.
// Keep in sync with setup.js FC_VERSION until we deprecate that path.
const PINNED_VERSION = '148.0.7778.215';
const KERNEL_FAMILY = 'fingerprint-chromium';
const REPO = 'adryfish/fingerprint-chromium';
const GH_PROXY = 'https://gh-proxy.com/';
const NETWORK_PROBE_URL = 'https://www.google.com';
const NETWORK_PROBE_TIMEOUT_MS = 3000;
const RELEASE_API_TIMEOUT_MS = 15000;

// Legacy bundled path (pre-Phase-1 installs still have this on disk).
function bundledResourceDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, KERNEL_FAMILY)
        : path.join(__dirname, '..', '..', '..', 'resources', KERNEL_FAMILY);
}

function installRoot() {
    return path.join(app.getPath('userData'), 'kernels', KERNEL_FAMILY);
}

function installDirFor(version) {
    return path.join(installRoot(), version);
}

async function pathExists(p) {
    try { await fsp.access(p); return true; } catch { return false; }
}

// A version is considered installed if VERSION file matches and a chrome
// executable exists somewhere under the tree.
async function checkInstalled(version = PINNED_VERSION) {
    const dir = installDirFor(version);
    const versionFile = path.join(dir, 'chrome', KERNEL_FAMILY, 'VERSION');
    if (!(await pathExists(versionFile))) return { installed: false };
    let recorded = '';
    try { recorded = (await fsp.readFile(versionFile, 'utf8')).trim(); } catch { }
    if (recorded !== version) return { installed: false };
    const execPath = await findChromeExecutable(path.join(dir, 'chrome', KERNEL_FAMILY));
    if (!execPath) return { installed: false };
    return { installed: true, execPath, dir };
}

// Walk kernel folder to find chrome(.exe) — same shape as chromium-path.js
// looks for, but scoped to a specific version dir.
async function findChromeExecutable(baseDir) {
    const targetName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
    async function walk(dir, depth = 0) {
        if (depth > 6) return null;
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                const nested = await walk(full, depth + 1);
                if (nested) return nested;
            } else if (e.name === targetName) {
                return full;
            }
        }
        return null;
    }
    return walk(baseDir);
}

// If the app used to ship the kernel bundled, move it into the new
// per-version dir so first-run doesn't re-download 400 MB.
async function migrateFromBundle(version = PINNED_VERSION) {
    const bundled = bundledResourceDir();
    const bundledVersionFile = path.join(bundled, 'chrome', KERNEL_FAMILY, 'VERSION');
    if (!(await pathExists(bundledVersionFile))) return { migrated: false, reason: 'no-bundle' };

    let bundledVersion = '';
    try { bundledVersion = (await fsp.readFile(bundledVersionFile, 'utf8')).trim(); } catch { }
    if (bundledVersion !== version) {
        return { migrated: false, reason: `version-mismatch: bundled=${bundledVersion || 'unknown'}, wanted=${version}` };
    }

    const targetDir = installDirFor(version);
    if (await pathExists(path.join(targetDir, 'chrome', KERNEL_FAMILY, 'VERSION'))) {
        return { migrated: false, reason: 'already-installed' };
    }
    await fsp.mkdir(path.dirname(targetDir), { recursive: true });
    // Rename first (fast, same filesystem); fall back to copy on cross-device.
    try {
        await fsp.rename(bundled, targetDir);
    } catch (e) {
        if (e.code === 'EXDEV') {
            await copyDir(bundled, targetDir);
            try { await fsp.rm(bundled, { recursive: true, force: true }); } catch { }
        } else {
            throw e;
        }
    }
    return { migrated: true, path: targetDir };
}

async function copyDir(src, dst) {
    await fsp.mkdir(dst, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if (e.isDirectory()) await copyDir(s, d);
        else if (e.isSymbolicLink()) await fsp.symlink(await fsp.readlink(s), d);
        else await fsp.copyFile(s, d);
    }
}

// Cheap 3s probe. If it fails we assume CN network + gh-proxy fallback.
function detectGlobalNetwork() {
    return new Promise((resolve) => {
        const req = https.get(NETWORK_PROBE_URL, { timeout: NETWORK_PROBE_TIMEOUT_MS }, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

// Fetch release metadata to select the right asset for our platform.
// Returns { url, name, size, assetPlatform }. Falls back to hardcoded URLs
// if the GitHub API is unreachable / rate-limited.
async function resolveDownloadUrl(version, useMirror) {
    const platform = process.platform;
    const platformPref = {
        win32:  { keyword: 'windows_x64', exts: ['.zip'] },
        darwin: { keyword: 'macos',       exts: ['.zip', '.dmg'] },
        linux:  { keyword: 'linux',       exts: ['.tar.xz', '.tar.gz', '.zip'] }
    }[platform];
    if (!platformPref) throw new Error(`Unsupported platform: ${platform}`);

    const apiUrl = `https://api.github.com/repos/${REPO}/releases/tags/${version}`;
    const effectiveApiUrl = useMirror ? GH_PROXY + apiUrl : apiUrl;
    try {
        const release = await fetchJson(effectiveApiUrl);
        const assets = (release.assets || []).filter(a => a.name.includes(platformPref.keyword));
        let picked = null;
        for (const ext of platformPref.exts) {
            picked = assets.find(a => a.name.toLowerCase().endsWith(ext));
            if (picked) break;
        }
        if (!picked) throw new Error(`no asset for ${platform} in release ${version}`);
        const rawUrl = picked.browser_download_url;
        return {
            url: useMirror ? GH_PROXY + rawUrl : rawUrl,
            rawUrl,
            name: picked.name,
            size: picked.size
        };
    } catch (e) {
        // Fallback: reconstruct URL by convention (setup.js does the same).
        const base = `https://github.com/${REPO}/releases/download/${version}`;
        const conventional = {
            win32:  `${base}/ungoogled-chromium_${version}-1.1_windows_x64.zip`,
            darwin: `${base}/ungoogled-chromium_${version}-1.1_macos.dmg`,
            linux:  `${base}/ungoogled-chromium-${version}-1-x86_64_linux.tar.xz`
        }[platform];
        if (!conventional) throw new Error(`no fallback URL for ${platform}`);
        return {
            url: useMirror ? GH_PROXY + conventional : conventional,
            rawUrl: conventional,
            name: path.basename(conventional),
            size: 0,
            fallback: true,
            fallbackReason: e.message
        };
    }
}

function fetchJson(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        https.get({
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: { 'User-Agent': 'GeekEZ-Kernel-Manager', 'Accept': 'application/vnd.github+json' },
            timeout: RELEASE_API_TIMEOUT_MS
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
                const next = new URL(res.headers.location, url).toString();
                res.resume();
                fetchJson(next, redirectsLeft - 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}`));
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
            });
        }).on('error', reject).on('timeout', function () { this.destroy(new Error('release-api timeout')); });
    });
}

async function extractArchive(archivePath, destDir) {
    const lower = archivePath.toLowerCase();
    await fsp.mkdir(destDir, { recursive: true });
    if (lower.endsWith('.zip')) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destDir, true);
        return;
    }
    if (lower.endsWith('.tar.xz')) return spawnTar('-xJf', archivePath, destDir);
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return spawnTar('-xzf', archivePath, destDir);
    if (lower.endsWith('.tar.bz2')) return spawnTar('-xjf', archivePath, destDir);
    if (lower.endsWith('.dmg')) return extractDmg(archivePath, destDir);
    throw new Error(`unsupported archive: ${archivePath}`);
}

function spawnTar(flag, archivePath, destDir) {
    const r = spawnSync('tar', [flag, archivePath, '-C', destDir], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.error) throw new Error(`tar not on PATH: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`tar exited ${r.status}: ${r.stderr?.toString?.() || ''}`);
}

function extractDmg(archivePath, destDir) {
    if (os.platform() !== 'darwin') throw new Error('.dmg extraction requires macOS hdiutil');
    const mountPoint = path.join(os.tmpdir(), `fc-mount-${Date.now()}`);
    fs.mkdirSync(mountPoint, { recursive: true });
    const attach = spawnSync('hdiutil', ['attach', '-nobrowse', '-quiet', '-mountpoint', mountPoint, archivePath]);
    if (attach.status !== 0) throw new Error(`hdiutil attach failed (${attach.status})`);
    try {
        const entries = fs.readdirSync(mountPoint);
        const appName = entries.find(n => n.endsWith('.app'));
        if (!appName) throw new Error('no .app bundle in dmg');
        const cp = spawnSync('cp', ['-R', path.join(mountPoint, appName), path.join(destDir, appName)]);
        if (cp.status !== 0) throw new Error(`cp -R failed (${cp.status})`);
    } finally {
        spawnSync('hdiutil', ['detach', '-quiet', mountPoint]);
        try { fs.rmSync(mountPoint, { recursive: true, force: true }); } catch { }
    }
}

// Full install pipeline. Emits progress via onProgress; accepts AbortSignal.
async function installVersion(version, { onProgress = () => { }, signal = null } = {}) {
    const targetDir = installDirFor(version);
    const chromeSubdir = path.join(targetDir, 'chrome', KERNEL_FAMILY);
    const versionFile = path.join(chromeSubdir, 'VERSION');
    const downloadDir = path.join(targetDir, '.download');
    await fsp.mkdir(downloadDir, { recursive: true });

    onProgress({ phase: 'network', message: 'detecting network' });
    const isGlobal = await detectGlobalNetwork();
    const useMirror = !isGlobal;
    onProgress({ phase: 'network', message: useMirror ? 'CN mirror' : 'GitHub direct', isGlobal });

    onProgress({ phase: 'resolve', message: 'resolving download URL' });
    const asset = await resolveDownloadUrl(version, useMirror);
    onProgress({
        phase: 'resolve',
        message: `asset: ${asset.name}${asset.size ? ` (${(asset.size / 1024 / 1024).toFixed(1)} MB)` : ''}`,
        assetName: asset.name,
        assetSize: asset.size,
        fallback: !!asset.fallback
    });

    const archivePath = path.join(downloadDir, asset.name);
    const urlRewriter = (u) => u.startsWith(GH_PROXY) ? u.slice(GH_PROXY.length) : GH_PROXY + u;

    await downloadChunked(asset.url, archivePath, {
        onProgress: (p) => onProgress({ ...p, assetName: asset.name }),
        signal,
        urlRewriter
    });

    if (signal && signal.aborted) throw new Error('aborted');

    onProgress({ phase: 'extract', message: 'extracting archive' });
    // Fresh install: wipe the target chrome subdir so old files don't linger.
    try { await fsp.rm(chromeSubdir, { recursive: true, force: true }); } catch { }
    await fsp.mkdir(chromeSubdir, { recursive: true });
    await extractArchive(archivePath, chromeSubdir);
    await fsp.writeFile(versionFile, version, 'utf8');

    onProgress({ phase: 'verify', message: 'verifying executable' });
    const execPath = await findChromeExecutable(chromeSubdir);
    if (!execPath) {
        throw new Error('extraction succeeded but no chrome executable found');
    }

    // Cleanup: drop the archive but keep the .download dir empty (in case
    // future features want it).
    try { await fsp.unlink(archivePath); } catch { }
    try { await fsp.rm(downloadDir, { recursive: true, force: true }); } catch { }

    onProgress({ phase: 'done', message: 'installed', execPath, version });
    return { execPath, dir: targetDir, version };
}

// The high-level entry: check → migrate → install.
async function ensureInstalled(version = PINNED_VERSION, options = {}) {
    const existing = await checkInstalled(version);
    if (existing.installed) return { ...existing, source: 'cached' };

    const migration = await migrateFromBundle(version).catch((e) => ({ migrated: false, reason: e.message }));
    if (migration.migrated) {
        const post = await checkInstalled(version);
        if (post.installed) return { ...post, source: 'migrated' };
    }

    const result = await installVersion(version, options);
    return { ...result, installed: true, source: 'downloaded' };
}

// Scan install root for versions with a valid VERSION file.
async function listInstalled() {
    const root = installRoot();
    if (!(await pathExists(root))) return [];
    let entries = [];
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
    const results = [];
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const check = await checkInstalled(e.name);
        if (check.installed) {
            const stat = await fsp.stat(path.join(root, e.name)).catch(() => null);
            results.push({
                version: e.name,
                execPath: check.execPath,
                dir: check.dir,
                installedAt: stat?.mtimeMs || 0
            });
        }
    }
    // Newest kernel version first (semver-ish sort).
    results.sort((a, b) => compareVersions(b.version, a.version));
    return results;
}

function compareVersions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff) return diff;
    }
    return 0;
}

// 60 min TTL cache of the Releases API. `force: true` refreshes.
let availableCache = null;
async function listAvailable({ force = false } = {}) {
    const now = Date.now();
    if (!force && availableCache && (now - availableCache.at) < 60 * 60 * 1000) {
        return availableCache.data;
    }
    const isGlobal = await detectGlobalNetwork();
    const apiUrl = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
    const finalUrl = isGlobal ? apiUrl : (GH_PROXY + apiUrl);
    let releases;
    try {
        releases = await fetchJson(finalUrl);
    } catch (e) {
        // Fall back to the mirror if the primary source failed.
        try { releases = await fetchJson(isGlobal ? (GH_PROXY + apiUrl) : apiUrl); }
        catch (_) { throw e; }
    }
    if (!Array.isArray(releases)) throw new Error('unexpected releases response');

    const platform = process.platform;
    const keyword = { win32: 'windows_x64', darwin: 'macos', linux: 'linux' }[platform];
    const exts    = { win32: ['.zip'],       darwin: ['.zip', '.dmg'], linux: ['.tar.xz', '.tar.gz', '.zip'] }[platform];

    const data = releases
        .map(r => {
            const version = String(r.tag_name || r.name || '').trim();
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) return null;
            const assets = (r.assets || []).filter(a => (a.name || '').includes(keyword));
            let asset = null;
            for (const ext of exts) {
                asset = assets.find(a => a.name.toLowerCase().endsWith(ext));
                if (asset) break;
            }
            if (!asset) return null;
            return {
                version,
                assetName: asset.name,
                assetSize: asset.size,
                publishedAt: r.published_at
            };
        })
        .filter(Boolean)
        .sort((a, b) => compareVersions(b.version, a.version));

    availableCache = { at: now, data };
    return data;
}

async function uninstallVersion(version) {
    const dir = installDirFor(version);
    if (!(await pathExists(dir))) return { removed: false, reason: 'not-installed' };
    await fsp.rm(dir, { recursive: true, force: true });
    return { removed: true, path: dir };
}

module.exports = {
    PINNED_VERSION,
    KERNEL_FAMILY,
    installRoot,
    installDirFor,
    checkInstalled,
    migrateFromBundle,
    installVersion,
    ensureInstalled,
    detectGlobalNetwork,
    listInstalled,
    listAvailable,
    uninstallVersion,
    compareVersions
};
