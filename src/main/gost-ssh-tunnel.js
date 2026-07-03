const fs = require('fs-extra');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const { parseSshProxyConfig } = require('./ssh-tunnel');

const DEFAULT_DOWNLOAD_BASE_URL = 'http://api.3o9.cn/geekez/gost-ssh-tunnel';

function getGostSshTunnelAssetName() {
    const exeName = process.platform === 'win32' ? 'gost-ssh-tunnel.exe' : 'gost-ssh-tunnel';
    return {
        platformArch: `${process.platform}-${process.arch}`,
        exeName
    };
}

function getGostSshTunnelBinary(binDir) {
    return path.join(binDir, getGostSshTunnelAssetName().exeName);
}

function buildGostSshTunnelDownloadUrl(baseUrl) {
    const { platformArch, exeName } = getGostSshTunnelAssetName();
    return `${String(baseUrl || DEFAULT_DOWNLOAD_BASE_URL).replace(/\/+$/, '')}/${platformArch}/${exeName}`;
}

function downloadFile(url, dest) {
    const client = String(url).startsWith('https:') ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.get(url, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                response.resume();
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`download failed: HTTP ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(dest);
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', reject);
        });
        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy(new Error('download timeout'));
        });
    });
}

async function ensureGostSshTunnelBinary(options = {}) {
    const {
        bundledBinDir,
        cacheDir,
        downloadBaseUrl = process.env.GEEKEZ_GOST_SSH_BASE_URL || DEFAULT_DOWNLOAD_BASE_URL
    } = options;

    const bundledPath = bundledBinDir ? getGostSshTunnelBinary(bundledBinDir) : '';
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;

    if (!cacheDir) {
        throw new Error('gost ssh tunnel cache dir is required');
    }

    const { platformArch, exeName } = getGostSshTunnelAssetName();
    const targetDir = path.join(cacheDir, platformArch);
    const targetPath = path.join(targetDir, exeName);
    if (fs.existsSync(targetPath)) return targetPath;

    await fs.ensureDir(targetDir);
    const tempPath = `${targetPath}.download`;
    try { await fs.remove(tempPath); } catch (e) { }
    await downloadFile(buildGostSshTunnelDownloadUrl(downloadBaseUrl), tempPath);
    if (process.platform !== 'win32') {
        await fs.chmod(tempPath, 0o755);
    }
    await fs.move(tempPath, targetPath, { overwrite: true });
    return targetPath;
}

function toGostConfig(proxyString, localPort) {
    const ssh = parseSshProxyConfig(proxyString);
    return {
        listen: `127.0.0.1:${localPort}`,
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        password: ssh.password,
        privateKeyPath: ssh.privateKeyPath,
        privateKey: ssh.privateKey,
        passphrase: ssh.passphrase,
        poolSize: ssh.poolSize,
        timeoutMs: ssh.readyTimeout || 15000,
        keepAliveSeconds: 15
    };
}

async function startGostSshTunnel(proxyString, localPort, options = {}) {
    const {
        binDir,
        cacheDir,
        downloadBaseUrl,
        configPath,
        logPath,
        cwd = binDir
    } = options;

    const binaryPath = await ensureGostSshTunnelBinary({
        bundledBinDir: binDir,
        cacheDir,
        downloadBaseUrl
    });
    if (!configPath) {
        throw new Error('gost ssh tunnel config path is required');
    }

    const config = toGostConfig(proxyString, localPort);
    await fs.writeJson(configPath, config, { spaces: 2 });

    let logFd = null;
    if (logPath) {
        await fs.ensureDir(require('path').dirname(logPath));
        logFd = fs.openSync(logPath, 'a');
    }

    const stdio = logFd !== null ? ['ignore', logFd, logFd] : ['ignore', 'ignore', 'pipe'];
    const proc = spawn(binaryPath, ['-config', configPath], {
        cwd: cwd || path.dirname(binaryPath),
        stdio,
        windowsHide: true
    });

    let stderr = '';
    if (proc.stderr) {
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });
    }

    const close = async () => {
        if (logFd !== null) {
            try { fs.closeSync(logFd); } catch (e) { }
            logFd = null;
        }
        if (proc.exitCode === null && !proc.killed) {
            try { proc.kill(); } catch (e) { }
        }
        try { await fs.remove(configPath); } catch (e) { }
    };

    return {
        type: 'gost-ssh',
        localPort,
        pid: proc.pid,
        config,
        process: proc,
        getExitCode: () => proc.exitCode,
        getStderr: () => stderr,
        close
    };
}

module.exports = {
    buildGostSshTunnelDownloadUrl,
    ensureGostSshTunnelBinary,
    getGostSshTunnelBinary,
    startGostSshTunnel
};
