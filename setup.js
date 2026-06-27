const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const readline = require('readline'); // 引入 readline 用于控制光标
const { resolveXrayAssetName } = require('./src/main/xray-assets');

// 配置
const RESOURCES_BIN = path.join(__dirname, 'resources', 'bin');
const PLATFORM_ARCH = `${os.platform()}-${os.arch()}`; // e.g., darwin-arm64, win32-x64
const BIN_DIR = path.join(RESOURCES_BIN, PLATFORM_ARCH);
const GH_PROXY = 'https://gh-proxy.com/';
const XRAY_API_URL = 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';

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
    const elapsedTime = (Date.now() - startTime) / 1000; // seconds
    const speed = elapsedTime > 0 ? (received / elapsedTime) : 0; // bytes/sec

    // 进度条视觉效果 [==========----------]
    const barLength = 30; // 稍微加长一点
    const filledLength = total > 0 ? Math.round((barLength * received) / total) : 0;
    // 防止计算溢出
    const validFilledLength = filledLength > barLength ? barLength : filledLength;
    const bar = '█'.repeat(validFilledLength) + '░'.repeat(barLength - validFilledLength);

    const speedStr = formatBytes(speed) + '/s';
    const receivedStr = formatBytes(received);
    const totalStr = formatBytes(total);

    // 构造输出字符串，使用 \r 回到行首实现单行刷新
    const output = `\r${prefix} [${bar}] ${percent}% | ${receivedStr}/${totalStr} | ${speedStr}`;

    // 直接使用 \r 回车符，更兼容各种终端
    process.stdout.write(output);
}

// --- 核心逻辑 ---

function getPlatformInfo() {
    const platform = os.platform();
    const arch = os.arch();
    let exeName = 'xray';
    const xrayAsset = resolveXrayAssetName({ platform, arch });

    if (!xrayAsset) {
        console.error('❌ Unsupported Platform/Arch:', `${platform}-${arch}`);
        process.exit(1);
    }

    if (platform === 'win32') {
        exeName = 'xray.exe';
    }

    return { xrayAsset, exeName };
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

// Fetch latest Xray version from GitHub API
function getLatestXrayVersion(useProxy = false) {
    return new Promise((resolve, reject) => {
        const url = useProxy ? (GH_PROXY + XRAY_API_URL) : XRAY_API_URL;
        const options = {
            headers: { 'User-Agent': 'GeekEZ-Browser-Setup' },
            timeout: 10000
        };

        const makeRequest = (requestUrl) => {
            const urlObj = new URL(requestUrl);
            const reqOptions = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                headers: { 'User-Agent': 'GeekEZ-Browser-Setup' },
                timeout: 10000
            };

            https.get(reqOptions, (res) => {
                // Handle redirects
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
                    try {
                        const json = JSON.parse(data);
                        resolve(json.tag_name); // e.g., "v24.12.31"
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
        };

        makeRequest(url);
    });
}

// 支持进度显示的下载函数
function downloadFile(url, dest, label = 'Downloading') {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (response) => {
            // 处理重定向
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
                    process.stdout.write('\n'); // 下载完成换行
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
            console.log('📦 Extracting...');
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(destDir, true);
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

async function main() {
    try {
        // 1. 准备 Xray
        if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

        const { xrayAsset, exeName } = getPlatformInfo();
        const zipPath = path.join(BIN_DIR, 'xray.zip');
        const isGlobal = await checkNetwork();

        console.log(`🌍 Network: ${isGlobal ? 'Global' : 'CN (Mirror)'}`);

        // Get latest Xray version from GitHub
        let xrayVersion;
        try {
            console.log('🔍 Fetching latest Xray version...');
            xrayVersion = await getLatestXrayVersion(!isGlobal);
            console.log(`📦 Latest version: ${xrayVersion}`);
        } catch (e) {
            console.log('⚠️  Failed to get latest version, using fallback: v26.3.27');
            xrayVersion = 'v26.3.27';
        }

        const baseUrl = `https://github.com/XTLS/Xray-core/releases/download/${xrayVersion}/${xrayAsset}`;
        const downloadUrl = isGlobal ? baseUrl : (GH_PROXY + baseUrl);

        process.stdout.write(`⬇️  Downloading Xray (${xrayVersion})...\n`);

        // 这里的 Label 用于进度条前缀
        await downloadFile(downloadUrl, zipPath, 'Xray Core');

        await extractZip(zipPath, BIN_DIR);
        fs.unlinkSync(zipPath);

        // Move shared resources (geoip.dat, geosite.dat) to common bin directory for asset loading
        const sharedFiles = ['geoip.dat', 'geosite.dat', 'LICENSE', 'README.md'];
        sharedFiles.forEach(file => {
            const srcPath = path.join(BIN_DIR, file);
            const destPath = path.join(RESOURCES_BIN, file);
            if (fs.existsSync(srcPath)) {
                // Only copy if not exists or source is newer
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(srcPath, destPath);
                }
                // Remove from platform dir to save space
                fs.unlinkSync(srcPath);
            }
        });

        if (os.platform() !== 'win32') fs.chmodSync(path.join(BIN_DIR, exeName), '755');
        console.log(`✅ Xray Updated Successfully! (Platform: ${PLATFORM_ARCH})`);

        // 2. 准备浏览器内核
        const DOWNLOAD_ROOT = path.join(__dirname, 'resources', 'puppeteer');
        const USE_CFT = process.env.USE_CHROME_FOR_TESTING === '1';

        if (USE_CFT) {
            // --- Chrome for Testing (fallback) ---
            process.stdout.write('⬇️  Downloading Chrome for Testing...\n');
            const { install } = require('@puppeteer/browsers');
            const BUILD_ID = '147.0.7727.50';
            const MIRROR_URL = 'https://npmmirror.com/mirrors/chrome-for-testing';

            if (fs.existsSync(DOWNLOAD_ROOT)) {
                console.log(`🧹 Cleaning existing Chrome directory...`);
                fs.rmSync(DOWNLOAD_ROOT, { recursive: true, force: true });
            }

            const baseUrlChrome = isGlobal ? undefined : MIRROR_URL;
            const chromeStartTime = Date.now();

            const result = await install({
                cacheDir: DOWNLOAD_ROOT,
                browser: 'chrome',
                buildId: BUILD_ID,
                unpack: true,
                baseUrl: baseUrlChrome,
                downloadProgressCallback: (downloadedBytes, totalBytes) => {
                    showProgress(downloadedBytes, totalBytes, chromeStartTime, 'Chrome   ');
                }
            });

            process.stdout.write('\n');
            console.log('✅ Chrome for Testing downloaded successfully!');
            console.log(`📂 Install Path: ${result.path}`);
        } else {
            // --- fingerprint-chromium (primary) ---
            const FC_VERSION = '148.0.7778.215';
            const FC_TARGET_DIR = path.join(DOWNLOAD_ROOT, 'chrome', 'fingerprint-chromium');
            const FC_VERSION_FILE = path.join(FC_TARGET_DIR, 'VERSION');

            // 检查是否已存在且版本匹配
            let needDownload = true;
            if (fs.existsSync(FC_VERSION_FILE)) {
                const installed = fs.readFileSync(FC_VERSION_FILE, 'utf8').trim();
                if (installed === FC_VERSION) {
                    console.log(`✅ fingerprint-chromium ${FC_VERSION} already installed, skipping download.`);
                    needDownload = false;
                }
            }

            if (needDownload) {
                process.stdout.write(`⬇️  Downloading fingerprint-chromium ${FC_VERSION}...\n`);

                // 查询 GitHub Release 获取下载 URL
                const FC_API_URL = `https://api.github.com/repos/adryfish/fingerprint-chromium/releases/tags/v${FC_VERSION}`;
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

                    // 根据平台选择 asset
                    const platformMap = {
                        win32: 'chrome-win64',
                        darwin: 'chrome-mac',
                        linux: 'chrome-linux64',
                    };
                    const platformKeyword = platformMap[os.platform()];
                    const asset = (releaseData.assets || []).find(a =>
                        a.name.endsWith('.zip') && a.name.includes(platformKeyword)
                    );

                    if (!asset) {
                        throw new Error(`No matching asset found for platform ${os.platform()}. Available: ${(releaseData.assets || []).map(a => a.name).join(', ')}`);
                    }

                    downloadUrl = isGlobal ? asset.browser_download_url : (GH_PROXY + asset.browser_download_url);
                    console.log(`📦 Asset: ${asset.name} (${formatBytes(asset.size)})`);
                } catch (e) {
                    console.error(`⚠️  GitHub API query failed: ${e.message}`);
                    // Fallback 1: 使用硬编码的直链
                    const FC_BASE = `https://github.com/adryfish/fingerprint-chromium/releases/download/v${FC_VERSION}`;
                    const HARDCODED_URLS = {
                        win32: `${FC_BASE}/chrome-win64.zip`,
                        darwin: `${FC_BASE}/chrome-mac-x64.zip`,
                        linux: `${FC_BASE}/chrome-linux64.zip`,
                    };
                    downloadUrl = isGlobal ? HARDCODED_URLS[os.platform()] : (GH_PROXY + HARDCODED_URLS[os.platform()]);

                    if (!downloadUrl || !HARDCODED_URLS[os.platform()]) {
                        console.error(`❌ No download URL for platform ${os.platform()}`);
                        console.log('💡 Falling back to Chrome for Testing...');
                        const { install } = require('@puppeteer/browsers');
                        const BUILD_ID = '147.0.7727.50';
                        if (fs.existsSync(DOWNLOAD_ROOT)) {
                            fs.rmSync(DOWNLOAD_ROOT, { recursive: true, force: true });
                        }
                        const chromeStartTime = Date.now();
                        const result = await install({
                            cacheDir: DOWNLOAD_ROOT,
                            browser: 'chrome',
                            buildId: BUILD_ID,
                            unpack: true,
                            baseUrl: isGlobal ? undefined : 'https://npmmirror.com/mirrors/chrome-for-testing',
                            downloadProgressCallback: (downloadedBytes, totalBytes) => {
                                showProgress(downloadedBytes, totalBytes, chromeStartTime, 'Chrome   ');
                            }
                        });
                        process.stdout.write('\n');
                        console.log('✅ Chrome for Testing downloaded (fallback)!');
                        console.log(`📂 Install Path: ${result.path}`);
                        console.log('✨ All Setup Completed! Exiting...');
                        process.exit(0);
                    }

                    console.log('📦 Using hardcoded download URL (API fallback)');
                }

                // 清理旧版本
                if (fs.existsSync(FC_TARGET_DIR)) {
                    fs.rmSync(FC_TARGET_DIR, { recursive: true, force: true });
                }
                fs.mkdirSync(FC_TARGET_DIR, { recursive: true });

                // 下载
                const zipPath = path.join(FC_TARGET_DIR, '..', 'fc-temp.zip');
                const fcStartTime = Date.now();
                await downloadFile(downloadUrl, zipPath, 'FP-Chrome ');

                // 解压
                await extractZip(zipPath, FC_TARGET_DIR);

                // 清理 zip
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

                // 写入版本文件
                fs.writeFileSync(FC_VERSION_FILE, FC_VERSION);

                process.stdout.write('\n');
                console.log('✅ fingerprint-chromium downloaded successfully!');
                console.log(`📂 Install Path: ${FC_TARGET_DIR}`);
            }
        }

        console.log('✨ All Setup Completed! Exiting...');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Setup Failed:', error);
        process.exit(1);
    }
}

main();
