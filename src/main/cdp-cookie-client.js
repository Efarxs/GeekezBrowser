const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');

function pickPort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function fetchJson(port, urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
    });
}

async function waitForDebugger(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            const info = await fetchJson(port, '/json/version');
            if (info && info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
        } catch (err) {
            lastErr = err;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Chrome CDP endpoint not ready within ${timeoutMs}ms: ${lastErr?.message || 'unknown'}`);
}

function connectCdp(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
        let nextId = 1;
        const pending = new Map();
        const openTimeout = setTimeout(() => {
            try { ws.close(); } catch (e) { }
            reject(new Error('CDP websocket open timeout'));
        }, 5000);
        ws.on('open', () => {
            clearTimeout(openTimeout);
            resolve({
                send(method, params) {
                    return new Promise((resolveMsg, rejectMsg) => {
                        const id = nextId++;
                        pending.set(id, { resolveMsg, rejectMsg });
                        ws.send(JSON.stringify({ id, method, params: params || {} }));
                    });
                },
                close() {
                    return new Promise((resolveClose) => {
                        try {
                            ws.once('close', () => resolveClose());
                            ws.close();
                        } catch (e) { resolveClose(); }
                    });
                }
            });
        });
        ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch (e) { return; }
            if (typeof msg.id === 'number' && pending.has(msg.id)) {
                const { resolveMsg, rejectMsg } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) rejectMsg(new Error(msg.error.message || 'CDP error'));
                else resolveMsg(msg.result);
            }
        });
        ws.on('error', (err) => {
            for (const { rejectMsg } of pending.values()) rejectMsg(err);
            pending.clear();
            reject(err);
        });
    });
}

async function withHeadlessChromeCookies(chromePath, userDataDir, fn) {
    if (!chromePath) throw new Error('chromePath is required');
    const port = await pickPort();
    const args = [
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--disable-gpu',
        '--disable-background-networking',
        '--no-service-autorun',
        '--password-store=basic'
    ];
    const proc = spawn(chromePath, args, {
        cwd: path.dirname(chromePath),
        stdio: 'ignore',
        windowsHide: true,
        detached: false
    });

    const exitPromise = new Promise((resolve) => proc.once('exit', () => resolve()));

    let session = null;
    try {
        const wsUrl = await waitForDebugger(port, 10000);
        session = await connectCdp(wsUrl);
        // Don't send Network.enable here — this is a browser-level CDP
        // session and Network domain isn't attached at that scope. Callers
        // should use browser-level equivalents (Storage.getCookies,
        // Storage.setCookies) which DO work here.
        return await fn(session);
    } finally {
        if (session) {
            try { await session.send('Browser.close'); } catch (e) { }
            try { await session.close(); } catch (e) { }
        }
        try {
            if (proc.pid && !proc.killed) {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                } else {
                    try { proc.kill('SIGKILL'); } catch (e) { }
                }
            }
        } catch (e) { }
        await Promise.race([
            exitPromise,
            new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
    }
}

module.exports = { withHeadlessChromeCookies };
