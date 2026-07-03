const fs = require('fs');
const net = require('net');
const { Client } = require('ssh2');

function isSshProxyString(value) {
    const raw = String(value || '').trim();
    return raw.startsWith('ssh://') || /^ssh\s+/i.test(raw);
}

function splitCommandLine(input) {
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (const ch of String(input || '')) {
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch === '\\') {
            escaping = true;
            continue;
        }
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current) tokens.push(current);
    return tokens;
}

function parseSshTarget(target, fallbackUsername = '') {
    const atIndex = String(target || '').lastIndexOf('@');
    if (atIndex === -1) {
        return { username: fallbackUsername, host: target };
    }
    return {
        username: target.substring(0, atIndex) || fallbackUsername,
        host: target.substring(atIndex + 1)
    };
}

function parseSshCommand(raw) {
    const tokens = splitCommandLine(raw);
    if (!tokens.length || String(tokens[0]).toLowerCase() !== 'ssh') {
        throw new Error('Invalid SSH proxy command');
    }

    let port = 22;
    let username = '';
    let privateKeyPath = '';
    let passphrase = '';
    let target = '';
    const extra = [];

    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '-p' && tokens[i + 1]) {
            port = Number(tokens[++i]);
        } else if (token.startsWith('-p') && token.length > 2) {
            port = Number(token.slice(2));
        } else if (token === '-l' && tokens[i + 1]) {
            username = tokens[++i];
        } else if (token === '-i' && tokens[i + 1]) {
            privateKeyPath = tokens[++i];
        } else if (token === '--passphrase' && tokens[i + 1]) {
            passphrase = tokens[++i];
        } else if (['-o', '-J', '-b', '-c', '-D', '-L', '-R', '-W'].includes(token) && tokens[i + 1]) {
            i++;
        } else if (token.startsWith('-')) {
            continue;
        } else if (!target) {
            target = token;
        } else {
            extra.push(token);
        }
    }

    const parsedTarget = parseSshTarget(target, username);
    const password = extra.length ? extra.join(' ') : '';
    return normalizeSshConfig({
        host: parsedTarget.host,
        port,
        username: parsedTarget.username,
        password,
        privateKeyPath,
        passphrase
    });
}

function parseSshUrl(raw) {
    const url = new URL(raw);
    const params = url.searchParams;
    return normalizeSshConfig({
        host: url.hostname,
        port: url.port ? Number(url.port) : 22,
        username: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
        privateKeyPath: params.get('privateKeyPath') || params.get('keyPath') || '',
        privateKey: params.get('privateKey') || '',
        passphrase: params.get('passphrase') || '',
        readyTimeout: params.get('readyTimeout') ? Number(params.get('readyTimeout')) : undefined
    });
}

function normalizeSshConfig(config) {
    const host = String(config.host || '').trim();
    const username = String(config.username || '').trim();
    const port = Number(config.port || 22);
    if (!host) throw new Error('SSH host is required');
    if (!username) throw new Error('SSH username is required');
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error('SSH port is invalid');
    }

    return {
        host,
        port,
        username,
        password: String(config.password || ''),
        privateKeyPath: String(config.privateKeyPath || ''),
        privateKey: config.privateKey || '',
        passphrase: String(config.passphrase || ''),
        readyTimeout: Number(config.readyTimeout) > 0 ? Number(config.readyTimeout) : 15000
    };
}

function parseSshProxyConfig(value) {
    const raw = String(value || '').trim();
    if (raw.startsWith('ssh://')) return parseSshUrl(raw);
    return parseSshCommand(raw);
}

function buildConnectOptions(config) {
    const options = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: config.readyTimeout,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3
    };

    if (config.password) options.password = config.password;
    if (config.privateKey) options.privateKey = config.privateKey;
    if (config.privateKeyPath) options.privateKey = fs.readFileSync(config.privateKeyPath);
    if (config.passphrase) options.passphrase = config.passphrase;
    return options;
}

function parseSocksRequest(buffer) {
    if (buffer.length < 4) return null;
    const version = buffer[0];
    const command = buffer[1];
    const atyp = buffer[3];
    if (version !== 0x05) throw new Error('Unsupported SOCKS version');
    if (command !== 0x01) throw new Error('Only SOCKS CONNECT is supported');

    let offset = 4;
    let dstAddr = '';
    if (atyp === 0x01) {
        if (buffer.length < offset + 4 + 2) return null;
        dstAddr = Array.from(buffer.subarray(offset, offset + 4)).join('.');
        offset += 4;
    } else if (atyp === 0x03) {
        if (buffer.length < offset + 1) return null;
        const len = buffer[offset++];
        if (buffer.length < offset + len + 2) return null;
        dstAddr = buffer.subarray(offset, offset + len).toString('utf8');
        offset += len;
    } else if (atyp === 0x04) {
        if (buffer.length < offset + 16 + 2) return null;
        const parts = [];
        for (let i = 0; i < 16; i += 2) {
            parts.push(buffer.readUInt16BE(offset + i).toString(16));
        }
        dstAddr = parts.join(':');
        offset += 16;
    } else {
        throw new Error('Unsupported SOCKS address type');
    }

    const dstPort = buffer.readUInt16BE(offset);
    offset += 2;
    return { dstAddr, dstPort, bytesRead: offset };
}

function sendSocksReply(socket, status) {
    socket.write(Buffer.from([0x05, status, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
}

function handleSocksConnection(socket, sshClient, sockets, channels) {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let stage = 'greeting';
    let connecting = false;

    const closeSocket = () => {
        sockets.delete(socket);
    };
    socket.on('close', closeSocket);
    socket.on('error', () => { });

    const fail = (status = 0x01) => {
        try { sendSocksReply(socket, status); } catch (e) { }
        setTimeout(() => {
            try { socket.destroy(); } catch (e) { }
        }, 20);
    };

    const onData = (chunk) => {
        if (connecting) return;
        buffer = Buffer.concat([buffer, chunk]);

        try {
            if (stage === 'greeting') {
                if (buffer.length < 2) return;
                const nmethods = buffer[1];
                const needed = 2 + nmethods;
                if (buffer.length < needed) return;
                if (buffer[0] !== 0x05) {
                    socket.destroy();
                    return;
                }
                socket.write(Buffer.from([0x05, 0x00]));
                buffer = buffer.subarray(needed);
                stage = 'request';
            }

            if (stage === 'request') {
                const request = parseSocksRequest(buffer);
                if (!request) return;
                connecting = true;
                const extra = buffer.subarray(request.bytesRead);
                socket.removeListener('data', onData);

                sshClient.forwardOut(
                    socket.remoteAddress || '127.0.0.1',
                    socket.remotePort || 0,
                    request.dstAddr,
                    request.dstPort,
                    (err, stream) => {
                        if (err || !stream) {
                            fail(0x05);
                            return;
                        }
                        channels.add(stream);
                        stream.on('close', () => channels.delete(stream));
                        stream.on('error', () => { });
                        sendSocksReply(socket, 0x00);
                        if (extra.length) stream.write(extra);
                        socket.pipe(stream).pipe(socket);
                    }
                );
            }
        } catch (err) {
            fail(0x01);
        }
    };

    socket.on('data', onData);
}

async function startSshSocksTunnel(proxyString, localPort) {
    const config = parseSshProxyConfig(proxyString);
    const sshClient = new Client();
    const sockets = new Set();
    const channels = new Set();
    let server = null;
    let closed = false;

    await new Promise((resolve, reject) => {
        const onReady = () => cleanup(resolve);
        const onError = (err) => cleanup(() => reject(err));
        const cleanup = (done) => {
            sshClient.off('ready', onReady);
            sshClient.off('error', onError);
            done();
        };

        sshClient.once('ready', onReady);
        sshClient.once('error', onError);
        sshClient.connect(buildConnectOptions(config));
    });

    await new Promise((resolve, reject) => {
        server = net.createServer((socket) => {
            handleSocksConnection(socket, sshClient, sockets, channels);
        });
        server.once('error', reject);
        server.listen(localPort, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    sshClient.on('close', () => {
        if (closed) return;
        for (const socket of sockets) {
            try { socket.destroy(); } catch (e) { }
        }
    });

    return {
        type: 'ssh2',
        localPort,
        config: {
            host: config.host,
            port: config.port,
            username: config.username
        },
        close: async () => {
            if (closed) return;
            closed = true;
            for (const stream of channels) {
                try { stream.destroy(); } catch (e) { }
            }
            for (const socket of sockets) {
                try { socket.destroy(); } catch (e) { }
            }
            await new Promise((resolve) => {
                if (!server) return resolve();
                try { server.close(() => resolve()); } catch (e) { resolve(); }
            });
            try { sshClient.end(); } catch (e) { }
        }
    };
}

module.exports = {
    isSshProxyString,
    parseSshProxyConfig,
    startSshSocksTunnel
};
