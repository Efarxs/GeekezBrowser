#!/usr/bin/env node
const net = require('net');
const tls = require('tls');
const { performance } = require('perf_hooks');
const { startSshSocksTunnel } = require('../src/main/ssh-tunnel');

function parseArgs(argv) {
    const args = {
        url: 'https://example.com/',
        rounds: 5,
        timeout: 15000
    };

    for (let i = 2; i < argv.length; i++) {
        const key = argv[i];
        const next = argv[i + 1];
        if (key === '--ssh' && next) args.ssh = argv[++i];
        else if (key === '--openssh-proxy' && next) args.openSshProxy = argv[++i];
        else if (key === '--url' && next) args.url = argv[++i];
        else if (key === '--rounds' && next) args.rounds = Math.max(1, Number(argv[++i]) || 1);
        else if (key === '--timeout' && next) args.timeout = Math.max(1000, Number(argv[++i]) || 15000);
        else if (key === '--help' || key === '-h') args.help = true;
    }

    return args;
}

function printHelp() {
    console.log([
        'Usage:',
        '  node scripts/compare-ssh-proxy.js --ssh "<ssh command or ssh:// url>" --openssh-proxy socks5://127.0.0.1:10808',
        '',
        'Example:',
        '  Start OpenSSH in another PowerShell first:',
        '    ssh -N -D 127.0.0.1:10808 root@216.167.21.243 -p 9443',
        '',
        '  Then compare:',
        '    node scripts/compare-ssh-proxy.js --ssh "ssh root@216.167.21.243 -p 9443 <password>" --openssh-proxy socks5://127.0.0.1:10808 --rounds 10',
        '    node scripts/compare-ssh-proxy.js --ssh "ssh root@216.167.21.243 -p 9443 --pool 4 <password>" --openssh-proxy socks5://127.0.0.1:10808 --rounds 10',
        '',
        'Options:',
        '  --ssh             SSH config used by the app ssh2 tunnel.',
        '  --openssh-proxy   Existing OpenSSH -D SOCKS proxy URL, for example socks5://127.0.0.1:10808.',
        '  --url             HTTPS URL to test. Default: https://example.com/',
        '  --rounds          Number of new-connection requests per proxy. Default: 5.',
        '  --timeout         Per-round timeout in ms. Default: 15000.'
    ].join('\n'));
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = address.port;
            server.close(() => resolve(port));
        });
    });
}

function parseProxyPort(proxyUrl) {
    const url = new URL(proxyUrl);
    if (!/^socks5h?:$/.test(url.protocol)) {
        throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
    }
    return {
        host: url.hostname || '127.0.0.1',
        port: Number(url.port || 1080)
    };
}

function onceEvent(emitter, event) {
    return new Promise((resolve) => emitter.once(event, resolve));
}

async function readAtLeast(socket, state, minLength, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (state.buffer.length < minLength) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Timed out waiting for SOCKS response');
        await Promise.race([
            onceEvent(socket, 'data'),
            onceEvent(socket, 'error').then((err) => { throw err; }),
            onceEvent(socket, 'close').then(() => { throw new Error('Socket closed'); }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SOCKS response')), remaining))
        ]);
    }
}

function attachBuffer(socket) {
    const state = { buffer: Buffer.alloc(0) };
    const onData = (chunk) => {
        state.buffer = Buffer.concat([state.buffer, chunk]);
    };
    socket.on('data', onData);
    state.detach = () => socket.off('data', onData);
    state.take = (count) => {
        const out = state.buffer.subarray(0, count);
        state.buffer = state.buffer.subarray(count);
        return out;
    };
    return state;
}

async function connectTcp(host, port, timeoutMs) {
    const startedAt = performance.now();
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    await Promise.race([
        onceEvent(socket, 'connect'),
        onceEvent(socket, 'error').then((err) => { throw err; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out connecting to local SOCKS proxy')), timeoutMs))
    ]);
    return { socket, ms: performance.now() - startedAt };
}

async function socksConnect(proxy, dstHost, dstPort, timeoutMs) {
    const tcp = await connectTcp(proxy.host, proxy.port, timeoutMs);
    const socket = tcp.socket;
    const state = attachBuffer(socket);
    const startedAt = performance.now();

    try {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
        await readAtLeast(socket, state, 2, timeoutMs);
        const greeting = state.take(2);
        if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
            throw new Error(`SOCKS auth failed: ${greeting.toString('hex')}`);
        }

        const hostBuffer = Buffer.from(dstHost, 'utf8');
        if (hostBuffer.length > 255) throw new Error('Destination host is too long');
        const request = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
            hostBuffer,
            Buffer.from([(dstPort >> 8) & 0xff, dstPort & 0xff])
        ]);
        socket.write(request);

        await readAtLeast(socket, state, 5, timeoutMs);
        const head = state.take(5);
        if (head[0] !== 0x05 || head[1] !== 0x00) {
            throw new Error(`SOCKS connect failed: ${head.toString('hex')}`);
        }

        let addressLength = 0;
        if (head[3] === 0x01) addressLength = 4;
        else if (head[3] === 0x03) addressLength = head[4];
        else if (head[3] === 0x04) addressLength = 16;
        else throw new Error(`Unsupported SOCKS bind address type: ${head[3]}`);

        const remaining = (head[3] === 0x03 ? addressLength : addressLength - 1) + 2;
        if (remaining > 0) {
            await readAtLeast(socket, state, remaining, timeoutMs);
            state.take(remaining);
        }

        const buffered = state.buffer;
        state.detach();
        if (buffered.length) socket.unshift(buffered);
        return {
            socket,
            localTcpMs: tcp.ms,
            socksMs: performance.now() - startedAt
        };
    } catch (err) {
        state.detach();
        socket.destroy();
        throw err;
    }
}

async function runHttpsRound(proxy, targetUrl, timeoutMs) {
    const url = new URL(targetUrl);
    if (url.protocol !== 'https:') throw new Error('Only https:// URLs are supported');
    const dstHost = url.hostname;
    const dstPort = Number(url.port || 443);
    const path = `${url.pathname || '/'}${url.search || ''}`;

    const roundStartedAt = performance.now();
    const socks = await socksConnect(proxy, dstHost, dstPort, timeoutMs);
    const tlsStartedAt = performance.now();
    const secureSocket = tls.connect({
        socket: socks.socket,
        servername: dstHost,
        ALPNProtocols: ['http/1.1']
    });
    secureSocket.setNoDelay(true);

    let firstByteMs = null;
    let bytes = 0;
    await Promise.race([
        onceEvent(secureSocket, 'secureConnect'),
        onceEvent(secureSocket, 'error').then((err) => { throw err; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out during TLS handshake')), timeoutMs))
    ]);

    const tlsMs = performance.now() - tlsStartedAt;
    const requestStartedAt = performance.now();
    secureSocket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${dstHost}`,
        'Connection: close',
        'User-Agent: GeekEZ-SSH-Compare/1.0',
        '',
        ''
    ].join('\r\n'));

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for HTTPS response')), timeoutMs);
        secureSocket.on('data', (chunk) => {
            if (firstByteMs === null) firstByteMs = performance.now() - requestStartedAt;
            bytes += chunk.length;
        });
        secureSocket.once('end', () => {
            clearTimeout(timer);
            resolve();
        });
        secureSocket.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    secureSocket.destroy();
    return {
        localTcpMs: socks.localTcpMs,
        socksMs: socks.socksMs,
        tlsMs,
        firstByteMs,
        totalMs: performance.now() - roundStartedAt,
        bytes
    };
}

function summarize(values) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    return {
        min: sorted[0],
        avg,
        p50,
        p90,
        max: sorted[sorted.length - 1]
    };
}

function fmt(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return `${value.toFixed(1)}ms`;
}

function printSummary(name, startupMs, results) {
    console.log(`\n== ${name} ==`);
    if (startupMs !== null) console.log(`startup: ${fmt(startupMs)}`);
    const fields = [
        ['localTcpMs', 'local tcp'],
        ['socksMs', 'socks+forward'],
        ['tlsMs', 'tls'],
        ['firstByteMs', 'first byte'],
        ['totalMs', 'total']
    ];
    for (const [key, label] of fields) {
        const stats = summarize(results.map((item) => item[key]));
        if (!stats) continue;
        console.log(`${label.padEnd(14)} min=${fmt(stats.min)} avg=${fmt(stats.avg)} p50=${fmt(stats.p50)} p90=${fmt(stats.p90)} max=${fmt(stats.max)}`);
    }
}

async function benchmarkProxy(name, proxy, targetUrl, rounds, timeoutMs) {
    const results = [];
    for (let i = 0; i < rounds; i++) {
        const roundNo = i + 1;
        try {
            const result = await runHttpsRound(proxy, targetUrl, timeoutMs);
            results.push(result);
            console.log(`${name} #${roundNo}: total=${fmt(result.totalMs)} socks=${fmt(result.socksMs)} tls=${fmt(result.tlsMs)} firstByte=${fmt(result.firstByteMs)} bytes=${result.bytes}`);
        } catch (err) {
            console.log(`${name} #${roundNo}: ERROR ${err.message || err}`);
        }
    }
    return results;
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help || !args.ssh) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    const proxies = [];
    let ssh2Tunnel = null;
    try {
        const ssh2Port = await findFreePort();
        const startedAt = performance.now();
        ssh2Tunnel = await startSshSocksTunnel(args.ssh, ssh2Port);
        proxies.push({
            name: 'ssh2',
            startupMs: performance.now() - startedAt,
            proxy: { host: '127.0.0.1', port: ssh2Port }
        });

        if (args.openSshProxy) {
            proxies.push({
                name: 'openssh',
                startupMs: null,
                proxy: parseProxyPort(args.openSshProxy)
            });
        }

        console.log(`target: ${args.url}`);
        console.log(`rounds: ${args.rounds}`);
        for (const item of proxies) {
            const results = await benchmarkProxy(item.name, item.proxy, args.url, args.rounds, args.timeout);
            printSummary(item.name, item.startupMs, results);
        }
    } finally {
        if (ssh2Tunnel) {
            await ssh2Tunnel.close().catch(() => { });
        }
    }
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
