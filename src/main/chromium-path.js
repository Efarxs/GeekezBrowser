const fs = require('fs');
const path = require('path');

const BUNDLED_BASENAMES = {
    darwin: ['Google Chrome for Testing', 'Google Chrome'],
    linux: ['chrome', 'google-chrome', 'chromium', 'chromium-browser'],
    win32: ['chrome.exe']
};

const PATH_CANDIDATES = {
    darwin: ['Google Chrome for Testing', 'Google Chrome'],
    linux: ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome'],
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
        if (filePath.endsWith(path.join('Contents', 'MacOS', 'Google Chrome for Testing'))) score += 200;
        if (filePath.endsWith(path.join('Contents', 'MacOS', 'Google Chrome'))) score += 180;
        if (normalized.includes('google chrome for testing.app')) score += 100;
        if (normalized.includes('fingerprint-chromium')) score += 300;
    } else if (platform === 'linux') {
        if (path.basename(filePath) === 'chrome') score += 200;
        if (normalized.includes('chrome-linux')) score += 100;
        if (normalized.includes('chrome-for-testing')) score += 50;
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
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            homeDir ? path.join(homeDir, 'Applications', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing') : null,
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

function resolveChromiumPath({ basePath, platform = process.platform, env = process.env } = {}) {
    // Priority 0: fingerprint-chromium (engine-level fingerprint spoofing)
    const fcPath = findBundledChromiumPath(path.join(basePath, 'chrome', 'fingerprint-chromium'), platform);
    if (fcPath) return fcPath;

    const bundledPath = findBundledChromiumPath(basePath, platform);
    if (bundledPath) return bundledPath;

    for (const candidate of listExplicitChromiumCandidates(env)) {
        if (isExecutableFile(candidate, platform)) return candidate;
    }

    const pathCandidate = findExecutableInPath(PATH_CANDIDATES[platform] || [], platform, env);
    if (pathCandidate) return pathCandidate;

    for (const candidate of listStandardChromiumCandidates(platform, env)) {
        if (isExecutableFile(candidate, platform)) return candidate;
    }

    return null;
}

function getChromiumPath({ isDev, appPath, resourcesPath, platform = process.platform, env = process.env } = {}) {
    const basePath = isDev ? path.join(appPath, 'resources', 'puppeteer') : path.join(resourcesPath, 'puppeteer');
    return resolveChromiumPath({ basePath, platform, env });
}

function getChromiumVersion({ isDev, appPath, resourcesPath, platform = process.platform } = {}) {
    const basePath = isDev ? path.join(appPath, 'resources', 'puppeteer') : path.join(resourcesPath, 'puppeteer');

    // Priority 1: fingerprint-chromium VERSION file
    const fcVersionFile = path.join(basePath, 'chrome', 'fingerprint-chromium', 'VERSION');
    try {
        if (fs.existsSync(fcVersionFile)) {
            const v = fs.readFileSync(fcVersionFile, 'utf8').trim();
            if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v;
            // fingerprint-chromium uses non-standard version (e.g., "148.0.7778.215")
            const m = v.match(/^(\d+\.\d+\.\d+\.\d+)/);
            if (m) return m[1];
        }
    } catch (_) {}

    // Priority 2: Chrome for Testing directory name (chrome/linux64-147.0.7727.50/)
    try {
        const chromeDir = path.join(basePath, 'chrome');
        if (fs.existsSync(chromeDir)) {
            const entries = fs.readdirSync(chromeDir);
            for (const entry of entries) {
                const m = entry.match(/(\d+\.\d+\.\d+\.\d+)$/);
                if (m) return m[1];
            }
        }
    } catch (_) {}

    return null;
}

module.exports = {
    getChromiumPath,
    getChromiumVersion,
    resolveChromiumPath
};
