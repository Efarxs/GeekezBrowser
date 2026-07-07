const fs = require('fs');
const path = require('path');

// fingerprint-chromium 各平台内二进制的 basename：
//   Windows: chrome.exe
//   macOS:   Chromium 或 Ungoogled Chromium（在 <Name>.app/Contents/MacOS/ 里）
//   Linux:   chrome
// 同时保留 Google Chrome 等以便系统装的 Chrome 也能作为回退。
const BUNDLED_BASENAMES = {
    darwin: ['Chromium', 'Ungoogled Chromium', 'Google Chrome'],
    linux: ['chrome', 'chromium', 'chromium-browser', 'google-chrome', 'ungoogled-chromium'],
    win32: ['chrome.exe']
};

const PATH_CANDIDATES = {
    darwin: ['Chromium', 'Google Chrome'],
    linux: ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome', 'ungoogled-chromium'],
    win32: ['chrome.exe', 'chrome']
};

function isExecutableFile(filePath, platform = process.platform) {
    if (!filePath) return false;
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return false;
        if (platform === 'win32') return true;
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch (error) {
        return false;
    }
}

function scoreBundledCandidate(filePath, platform = process.platform) {
    const normalized = filePath.toLowerCase();
    let score = 0;

    if (platform === 'darwin') {
        // 任何位于 .app/Contents/MacOS/ 里的可执行都比游离二进制优先
        if (filePath.includes(path.join('Contents', 'MacOS'))) score += 180;
        if (normalized.includes('fingerprint-chromium')) score += 300;
    } else if (platform === 'linux') {
        if (path.basename(filePath) === 'chrome') score += 200;
        if (normalized.includes('chrome-linux')) score += 100;
        if (normalized.includes('fingerprint-chromium')) score += 300;
    } else if (platform === 'win32') {
        if (path.basename(filePath).toLowerCase() === 'chrome.exe') score += 200;
        if (normalized.includes('chrome-win')) score += 100;
        if (normalized.includes('fingerprint-chromium')) score += 300;
    }

    return score;
}

function findBundledChromiumPath(basePath, platform = process.platform) {
    if (!basePath || !fs.existsSync(basePath)) return null;

    const basenames = new Set(BUNDLED_BASENAMES[platform] || []);
    let bestMatch = null;

    function walk(dir, depth = 0) {
        if (depth > 8) return;

        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }

            if (!entry.isFile() && !entry.isSymbolicLink()) continue;
            if (!basenames.has(entry.name)) continue;
            if (!isExecutableFile(fullPath, platform)) continue;

            const score = scoreBundledCandidate(fullPath, platform);
            if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && fullPath.length < bestMatch.path.length)) {
                bestMatch = { path: fullPath, score };
            }
        }
    }

    walk(basePath);
    return bestMatch ? bestMatch.path : null;
}

function findExecutableInPath(names, platform = process.platform, env = process.env) {
    const pathEntries = String(env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean);

    for (const name of names) {
        for (const dir of pathEntries) {
            const fullPath = path.join(dir, name);
            if (isExecutableFile(fullPath, platform)) return fullPath;
            if (platform === 'win32' && !name.toLowerCase().endsWith('.exe') && isExecutableFile(`${fullPath}.exe`, platform)) {
                return `${fullPath}.exe`;
            }
        }
    }

    return null;
}

function listExplicitChromiumCandidates(env = process.env) {
    return [env.CHROME_PATH, env.CHROMIUM_PATH].filter(Boolean);
}

function listStandardChromiumCandidates(platform = process.platform, env = process.env) {
    const homeDir = env.HOME || env.USERPROFILE || '';

    if (platform === 'darwin') {
        return [
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Ungoogled Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            homeDir ? path.join(homeDir, 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium') : null,
            homeDir ? path.join(homeDir, 'Applications', 'Ungoogled Chromium.app', 'Contents', 'MacOS', 'Chromium') : null,
            homeDir ? path.join(homeDir, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') : null
        ].filter(Boolean);
    }

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA || '';
        const programFiles = env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        return [
            localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
        ].filter(Boolean);
    }

    return [
        '/opt/google/chrome/chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium'
    ].filter(Boolean);
}

function resolveChromiumPath({ basePath, userDataKernelDir, platform = process.platform, env = process.env } = {}) {
    // Priority 0: on-demand-installed kernel under userData (Phase 1 default).
    if (userDataKernelDir) {
        const udPath = findBundledChromiumPath(path.join(userDataKernelDir, 'chrome', 'fingerprint-chromium'), platform);
        if (udPath) return udPath;
    }

    // Priority 1: bundled fingerprint-chromium (legacy, will be dropped once
    // Phase 1 ships everywhere).
    if (basePath) {
        const fcPath = findBundledChromiumPath(path.join(basePath, 'chrome', 'fingerprint-chromium'), platform);
        if (fcPath) return fcPath;
    }

    // Priority 2: Environment variable override
    for (const candidate of listExplicitChromiumCandidates(env)) {
        if (isExecutableFile(candidate, platform)) return candidate;
    }

    // Priority 3: System PATH
    const pathCandidate = findExecutableInPath(PATH_CANDIDATES[platform] || [], platform, env);
    if (pathCandidate) return pathCandidate;

    // Priority 4: Standard install locations
    for (const candidate of listStandardChromiumCandidates(platform, env)) {
        if (isExecutableFile(candidate, platform)) return candidate;
    }

    return null;
}

function getChromiumPath({ isDev, appPath, resourcesPath, userDataKernelDir, platform = process.platform, env = process.env } = {}) {
    const basePath = isDev ? path.join(appPath, 'resources', 'fingerprint-chromium') : path.join(resourcesPath, 'fingerprint-chromium');
    return resolveChromiumPath({ basePath, userDataKernelDir, platform, env });
}

function readVersionFrom(basePath) {
    if (!basePath) return null;
    const fcVersionFile = path.join(basePath, 'chrome', 'fingerprint-chromium', 'VERSION');
    try {
        if (fs.existsSync(fcVersionFile)) {
            const v = fs.readFileSync(fcVersionFile, 'utf8').trim();
            if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v;
            const m = v.match(/^(\d+\.\d+\.\d+\.\d+)/);
            if (m) return m[1];
        }
    } catch (_) {}

    // Fallback: scan chrome/ subdirectory names.
    try {
        const chromeDir = path.join(basePath, 'chrome');
        if (fs.existsSync(chromeDir)) {
            for (const entry of fs.readdirSync(chromeDir)) {
                const m = entry.match(/(\d+\.\d+\.\d+\.\d+)$/);
                if (m) return m[1];
            }
        }
    } catch (_) {}

    return null;
}

function getChromiumVersion({ isDev, appPath, resourcesPath, userDataKernelDir, platform = process.platform } = {}) {
    // Prefer userData install if present.
    const udVersion = readVersionFrom(userDataKernelDir);
    if (udVersion) return udVersion;

    const basePath = isDev ? path.join(appPath, 'resources', 'fingerprint-chromium') : path.join(resourcesPath, 'fingerprint-chromium');
    return readVersionFrom(basePath);
}

module.exports = {
    getChromiumPath,
    getChromiumVersion,
    resolveChromiumPath
};
