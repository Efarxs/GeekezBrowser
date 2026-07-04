const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { resolveSingBoxAssetName } = require('./src/main/singbox-assets');

// 配置
const RESOURCES_BIN = path.join(__dirname, 'resources', 'bin');
const PLATFORM_ARCH = `${os.platform()}-${os.arch()}`; // e.g., darwin-arm64, win32-x64
const BIN_DIR = path.join(RESOURCES_BIN, PLATFORM_ARCH);
const GH_PROXY = 'https://gh-proxy.com/';

// Sing-box 内核版本 —— 与 fingerprint-chromium 同样采用固定版本策略。
const SINGBOX_VERSION = '1.11.7';

// --- 辅助工具：格式化字节 ---
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- 核心：单行刷新进度条 ---
function showProgress(received, total, startTime, prefix = 'Downloading') {
    const percent = total > 0 ? ((received / total) * 100).toFixed(1) : 0;
    const elapsedTime = (Date.now() - startTime) / 1000;
    const speed = elapsedTime > 0 ? (received / elapsedTime) : 0;

    const barLength = 30;
    const filledLength = total > 0 ? Math.round((barLength * received) / total) : 0;
    const validFilledLength = filledLength > barLength ? barLength : filledLength;
    const bar = '█'.repeat(validFilledLength) + '░'.repeat(barLength - validFilledLength);

    const output = `\r${prefix} [${bar}] ${percent}% | ${formatBytes(received)}/${formatBytes(total)} | ${formatBytes(speed)}/s`;
    process.stdout.write(output);
}

function normalizeVersion(value) {
    return String(value || '').trim().replace(/^v/i, '');
}

function getInstalledSingBoxVersion(binaryPath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(binaryPath)) return resolve('');
        try {
            const proc = spawn(binaryPath, ['version'], { windowsHide: true });
            let output = '';
            proc.stdout.on('data', d => output += d.toString());
            proc.stderr.on('data', d => output += d.toString());
            proc.on('error', () => resolve(''));
            proc.on('close', () => {
                const match = output.match(/sing-box\s+version\s+(\d+\.\d+\.\d+)/i);
                resolve(match ? match[1] : '');
            });
        } catch (e) {
            resolve('');
        }
    });
}

function checkNetwork() {
    return new Promise((resolve) => {
        console.log('🌐 Checking network connectivity...');
        const req = https.get('https://www.google.com', { timeout: 3000 }, (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

function downloadFile(url, dest, label = 'Downloading') {
    return new Promise((resolve, reject) => {
        const client = String(url).startsWith('http:') ? http : https;
        const req = client.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadFile(response.headers.location, dest, label).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(dest);
            const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
            let receivedBytes = 0;
            const startTime = Date.now();

            response.on('data', (chunk) => {
                receivedBytes += chunk.length;
                showProgress(receivedBytes, totalBytes, startTime, label);
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    process.stdout.write('\n');
                    resolve();
                });
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
        req.on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

function extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        try {
            console.log('📦 Extracting zip...');
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(destDir, true);
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

function extractTarGz(archivePath, destDir) {
    console.log('📦 Extracting tar.gz...');
    // 优先用系统自带 tar（Linux/macOS/Windows 10+ 默认都有）
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], {
        stdio: ['ignore', 'inherit', 'inherit']
    });
    if (result.error) {
        throw new Error(`tar not available on PATH: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`tar exited with code ${result.status}`);
    }
}

function extractArchive(archivePath, ext, destDir) {
    if (ext === 'zip') return extractZip(archivePath, destDir);
    return extractTarGz(archivePath, destDir);
}

// 清理老资产（xray-core / gost-ssh-tunnel 遗留文件，方便老用户升级到 sing-box 时自动清理）
function purgeLegacyBinaries() {
    const stale = [
        path.join(BIN_DIR, 'xray.exe'),
        path.join(BIN_DIR, 'xray'),
        path.join(BIN_DIR, 'xray_no_window.ps1'),
        path.join(BIN_DIR, 'xray_no_window.vbs'),
        path.join(BIN_DIR, 'gost-ssh-tunnel.exe'),
        path.join(BIN_DIR, 'gost-ssh-tunnel'),
        path.join(RESOURCES_BIN, 'geoip.dat'),
        path.join(RESOURCES_BIN, 'geosite.dat'),
        path.join(RESOURCES_BIN, 'LICENSE'),
        path.join(RESOURCES_BIN, 'README.md'),
        path.join(BIN_DIR, 'geoip.dat'),
        path.join(BIN_DIR, 'geosite.dat')
    ];
    for (const p of stale) {
        try {
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                console.log(`🧹 Removed legacy asset: ${path.basename(p)}`);
            }
        } catch (e) { /* ignore */ }
    }
}

async function installSingBox(isGlobal) {
    const assetInfo = resolveSingBoxAssetName({
        platform: os.platform(),
        arch: os.arch(),
        version: SINGBOX_VERSION
    });
    if (!assetInfo) {
        console.error('❌ Unsupported platform/arch:', PLATFORM_ARCH);
        process.exit(1);
    }
    const { asset, ext, innerDir, execName } = assetInfo;

    const binaryPath = path.join(BIN_DIR, execName);
    const installed = await getInstalledSingBoxVersion(binaryPath);
    if (installed && normalizeVersion(installed) === normalizeVersion(SINGBOX_VERSION)) {
        console.log(`✅ sing-box ${installed} already installed, skipping download.`);
        return;
    }

    const baseUrl = `https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${asset}`;
    const downloadUrl = isGlobal ? baseUrl : (GH_PROXY + baseUrl);
    const archivePath = path.join(BIN_DIR, asset);

    process.stdout.write(`⬇️  Downloading sing-box v${SINGBOX_VERSION}...\n`);
    await downloadFile(downloadUrl, archivePath, 'sing-box ');

    // 解压到 BIN_DIR 下的临时子目录，然后把 sing-box(.exe) 提上来
    const tmpExtractDir = path.join(BIN_DIR, `.singbox-extract-${Date.now()}`);
    fs.mkdirSync(tmpExtractDir, { recursive: true });
    try {
        extractArchive(archivePath, ext, tmpExtractDir);

        // archive 内含 `<innerDir>/sing-box(.exe)` 子路径
        const innerBinary = path.join(tmpExtractDir, innerDir, execName);
        const finalPath = path.join(BIN_DIR, execName);
        if (!fs.existsSync(innerBinary)) {
            throw new Error(`Expected binary not found: ${innerBinary}`);
        }
        // 若旧版本存在先删掉
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        fs.renameSync(innerBinary, finalPath);
        if (os.platform() !== 'win32') fs.chmodSync(finalPath, '755');
    } finally {
        // 清理临时解压目录和 archive
        try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (e) { }
        try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch (e) { }
    }

    console.log(`✅ sing-box v${SINGBOX_VERSION} installed at ${path.join(BIN_DIR, execName)}`);
}

async function installFingerprintChromium(isGlobal) {
    const DOWNLOAD_ROOT = path.join(__dirname, 'resources', 'fingerprint-chromium');
    const FC_VERSION = '148.0.7778.215';
    const FC_TARGET_DIR = path.join(DOWNLOAD_ROOT, 'chrome', 'fingerprint-chromium');
    const FC_VERSION_FILE = path.join(FC_TARGET_DIR, 'VERSION');

    if (fs.existsSync(FC_VERSION_FILE)) {
        const installed = fs.readFileSync(FC_VERSION_FILE, 'utf8').trim();
        if (installed === FC_VERSION) {
            console.log(`✅ fingerprint-chromium ${FC_VERSION} already installed, skipping download.`);
            return;
        }
    }

    process.stdout.write(`⬇️  Downloading fingerprint-chromium ${FC_VERSION}...\n`);

    const FC_API_URL = `https://api.github.com/repos/adryfish/fingerprint-chromium/releases/tags/${FC_VERSION}`;
    let downloadUrl;
    try {
        const releaseData = await new Promise((resolve, reject) => {
            const makeRequest = (url) => {
                const urlObj = new URL(url);
                https.get({
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    headers: { 'User-Agent': 'GeekEZ-Browser-Setup' },
                    timeout: 15000
                }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        makeRequest(res.headers.location);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitHub API returned ${res.statusCode}`));
                        return;
                    }
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch (e) { reject(e); }
                    });
                }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
            };
            makeRequest(isGlobal ? FC_API_URL : (GH_PROXY + FC_API_URL));
        });

        const platformMap = { win32: 'windows_x64', darwin: 'macos', linux: 'linux' };
        const platformKeyword = platformMap[os.platform()];
        const asset = (releaseData.assets || []).find(a =>
            a.name.includes(platformKeyword) && (a.name.endsWith('.zip') || a.name.endsWith('.tar.xz'))
        );
        if (!asset) {
            throw new Error(`No matching asset found for ${os.platform()}`);
        }
        downloadUrl = isGlobal ? asset.browser_download_url : (GH_PROXY + asset.browser_download_url);
        console.log(`📦 Asset: ${asset.name} (${formatBytes(asset.size)})`);
    } catch (e) {
        console.error(`⚠️  GitHub API query failed: ${e.message}, using hardcoded URL...`);
        const FC_BASE = `https://github.com/adryfish/fingerprint-chromium/releases/download/${FC_VERSION}`;
        const HARDCODED_URLS = {
            win32: `${FC_BASE}/ungoogled-chromium_${FC_VERSION}-1.1_windows_x64.zip`,
            darwin: `${FC_BASE}/ungoogled-chromium_${FC_VERSION}-1.1_macos.dmg`,
            linux: `${FC_BASE}/ungoogled-chromium-${FC_VERSION}-1-x86_64_linux.tar.xz`,
        };
        downloadUrl = isGlobal ? HARDCODED_URLS[os.platform()] : (GH_PROXY + HARDCODED_URLS[os.platform()]);
        if (!downloadUrl) {
            console.error(`❌ No download URL for platform ${os.platform()}`);
            process.exit(1);
        }
    }

    if (fs.existsSync(FC_TARGET_DIR)) fs.rmSync(FC_TARGET_DIR, { recursive: true, force: true });
    fs.mkdirSync(FC_TARGET_DIR, { recursive: true });

    const zipPath = path.join(FC_TARGET_DIR, '..', 'fc-temp.zip');
    await downloadFile(downloadUrl, zipPath, 'FP-Chrome ');
    await extractZip(zipPath, FC_TARGET_DIR);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    fs.writeFileSync(FC_VERSION_FILE, FC_VERSION);
    console.log(`✅ fingerprint-chromium ${FC_VERSION} installed.`);
}

async function main() {
    try {
        if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
        const isGlobal = await checkNetwork();
        console.log(`🌍 Network: ${isGlobal ? 'Global' : 'CN (Mirror)'}`);

        purgeLegacyBinaries();
        await installSingBox(isGlobal);
        await installFingerprintChromium(isGlobal);

        console.log('✨ All setup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Setup Failed:', error);
        process.exit(1);
    }
}

main();
