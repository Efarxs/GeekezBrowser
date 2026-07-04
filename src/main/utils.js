const { Base64 } = require('js-base64');
const { URL } = require('url');

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function decodeBase64Content(str) {
    try {
        if (!str) return '';
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4 !== 0) str += '=';
        return Buffer.from(str, 'base64').toString('utf8');
    } catch (e) { return str; }
}

function parseIntSafe(value, fallback = 0) {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function splitCsv(str) {
    if (!str) return undefined;
    const arr = String(str).split(',').map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
}

// -------------------------------------------------------------------
// Remark extraction (unchanged behavior — used by UI)
// -------------------------------------------------------------------
function getProxyRemark(link) {
    if (!link) return '';
    link = link.trim();
    try {
        if (link.startsWith('vmess://')) {
            const configStr = decodeBase64Content(link.replace('vmess://', ''));
            const vmess = JSON.parse(configStr);
            return vmess.ps || '';
        } else if (link.startsWith('ssh://')) {
            const urlObj = new URL(link);
            return `${decodeURIComponent(urlObj.username || '')}@${urlObj.hostname}:${urlObj.port || 22}`.replace(/^@/, '');
        } else if (/^ssh\s+/i.test(link)) {
            const tokens = link.split(/\s+/).filter(Boolean);
            for (let i = 1; i < tokens.length; i++) {
                const token = tokens[i];
                if (['-p', '-i', '-l', '-o', '-J', '-b', '-c', '-D', '-L', '-R', '-W'].includes(token)) { i++; continue; }
                if (token.startsWith('-')) continue;
                return token;
            }
        } else if (link.includes('#')) {
            return decodeURIComponent(link.split('#')[1]).trim();
        }
    } catch (e) { return ''; }
    return '';
}

// -------------------------------------------------------------------
// TLS block builder — sing-box `tls` shape
// -------------------------------------------------------------------
function buildTls({
    serverName,
    insecure = false,
    alpn,
    utlsFingerprint,
    reality
}) {
    if (!serverName && !reality && !alpn) return undefined;
    const tls = { enabled: true };
    if (serverName) tls.server_name = serverName;
    if (insecure) tls.insecure = true;
    if (alpn && alpn.length) tls.alpn = alpn;

    if (utlsFingerprint) {
        tls.utls = { enabled: true, fingerprint: utlsFingerprint };
    }

    if (reality) {
        tls.reality = {
            enabled: true,
            public_key: reality.publicKey || '',
            short_id: reality.shortId || ''
        };
    }
    // Note: sing-box mainline has no public-key-SHA256 pin field. When the user's
    // hy2 URI carries pinSHA256, we rely on `insecure: true` (which those URIs
    // always come paired with) — pin verification would only be meaningful if
    // full CA validation were enabled anyway.
    return tls;
}

// -------------------------------------------------------------------
// Transport (v2ray-era network types → sing-box transport.type)
// -------------------------------------------------------------------
function buildTransport(params, defaultNet = 'tcp') {
    const net = String(params.get('type') || defaultNet).toLowerCase();
    if (net === 'tcp' || !net) return undefined;

    if (net === 'ws') {
        const t = { type: 'ws' };
        const p = params.get('path');
        if (p) t.path = p;
        const host = params.get('host');
        if (host) t.headers = { Host: host };
        return t;
    }
    if (net === 'grpc') {
        const t = { type: 'grpc' };
        const svc = params.get('serviceName') || params.get('servicename');
        if (svc) t.service_name = svc;
        return t;
    }
    if (net === 'http' || net === 'h2') {
        const t = { type: 'http' };
        const path = params.get('path');
        if (path) t.path = path;
        const host = params.get('host');
        if (host) t.host = host.split(',').map(s => s.trim()).filter(Boolean);
        return t;
    }
    if (net === 'httpupgrade') {
        const t = { type: 'httpupgrade' };
        const path = params.get('path');
        if (path) t.path = path;
        const host = params.get('host');
        if (host) t.host = host;
        return t;
    }
    // Unknown transport — fall back to omitting transport (tcp).
    return undefined;
}

// -------------------------------------------------------------------
// Per-protocol parsers → sing-box outbound objects
// -------------------------------------------------------------------
function parseVmess(link, tag, ctx = {}) {
    const configStr = decodeBase64Content(link.replace('vmess://', ''));
    const vmess = JSON.parse(configStr);
    const net = String(vmess.net || 'tcp').toLowerCase();
    const useTls = String(vmess.tls || '').toLowerCase() === 'tls';

    const outbound = {
        type: 'vmess',
        tag,
        server: vmess.add,
        server_port: parseIntSafe(vmess.port),
        uuid: vmess.id,
        security: vmess.scy || 'auto',
        alter_id: parseIntSafe(vmess.aid, 0)
    };

    // Fake URLSearchParams for buildTransport
    const params = new URLSearchParams();
    params.set('type', net);
    if (vmess.path) params.set('path', vmess.path);
    if (vmess.host) params.set('host', vmess.host);
    if (vmess.serviceName) params.set('serviceName', vmess.serviceName);
    const transport = buildTransport(params);
    if (transport) outbound.transport = transport;

    if (useTls) {
        outbound.tls = buildTls({
            serverName: vmess.sni || vmess.host || vmess.add,
            insecure: false,
            alpn: splitCsv(vmess.alpn),
            utlsFingerprint: ctx.utlsFingerprint
        });
    }
    return outbound;
}

function parseVless(link, tag, ctx = {}) {
    const urlObj = new URL(link);
    const params = urlObj.searchParams;
    const security = String(params.get('security') || 'none').toLowerCase();

    const outbound = {
        type: 'vless',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port),
        uuid: decodeURIComponent(urlObj.username)
    };

    const flow = params.get('flow');
    if (flow) outbound.flow = flow;

    const transport = buildTransport(params);
    if (transport) outbound.transport = transport;

    if (security === 'tls' || security === 'reality') {
        outbound.tls = buildTls({
            serverName: params.get('sni') || params.get('host') || urlObj.hostname,
            insecure: params.get('allowInsecure') === '1' || params.get('insecure') === '1',
            alpn: splitCsv(params.get('alpn')),
            utlsFingerprint: params.get('fp') || ctx.utlsFingerprint,
            reality: security === 'reality' ? {
                publicKey: params.get('pbk') || '',
                shortId: params.get('sid') || ''
            } : undefined
        });
    }
    return outbound;
}

function parseTrojan(link, tag, ctx = {}) {
    const urlObj = new URL(link);
    const params = urlObj.searchParams;

    const outbound = {
        type: 'trojan',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port),
        password: decodeURIComponent(urlObj.username)
    };

    const transport = buildTransport(params);
    if (transport) outbound.transport = transport;

    // Trojan defaults to TLS.
    const security = String(params.get('security') || 'tls').toLowerCase();
    if (security === 'tls') {
        outbound.tls = buildTls({
            serverName: params.get('sni') || params.get('host') || urlObj.hostname,
            insecure: params.get('allowInsecure') === '1' || params.get('insecure') === '1',
            alpn: splitCsv(params.get('alpn')),
            utlsFingerprint: params.get('fp') || ctx.utlsFingerprint
        });
    }
    return outbound;
}

function parseShadowsocks(link, tag) {
    let raw = link.replace('ss://', '');
    if (raw.includes('#')) raw = raw.split('#')[0];

    let method, password, host, port;
    if (raw.includes('@')) {
        const parts = raw.split('@');
        const userPart = parts[0];
        const hostPart = parts[1];

        if (!userPart.includes(':')) {
            const decoded = decodeBase64Content(userPart);
            if (decoded.includes(':')) {
                const colonIdx = decoded.indexOf(':');
                method = decoded.substring(0, colonIdx);
                password = decoded.substring(colonIdx + 1);
            } else {
                throw new Error('Invalid ss:// user part');
            }
        } else {
            const colonIdx = userPart.indexOf(':');
            method = userPart.substring(0, colonIdx);
            password = userPart.substring(colonIdx + 1);
        }

        const lastColonIndex = hostPart.lastIndexOf(':');
        if (lastColonIndex === -1) {
            host = hostPart; port = '8388';
        } else {
            host = hostPart.substring(0, lastColonIndex);
            port = hostPart.substring(lastColonIndex + 1);
        }
        if (port.includes('?')) port = port.split('?')[0];
        if (port.includes('/')) port = port.split('/')[0];
        if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    } else {
        const decoded = decodeBase64Content(raw);
        const match = decoded.match(/^(.*?):(.*?)@(.*?):(\d+)$/);
        if (match) {
            [, method, password, host, port] = match;
        } else {
            throw new Error('Invalid ss:// legacy format');
        }
    }

    const outbound = {
        type: 'shadowsocks',
        tag,
        server: host,
        server_port: parseIntSafe(port, 8388),
        method,
        password
    };

    // obfs plugin passthrough
    const fullLinkForParams = link.split('#')[0];
    if (fullLinkForParams.includes('?')) {
        const queryStr = fullLinkForParams.split('?')[1];
        const urlParams = new URLSearchParams(queryStr);
        const plugin = urlParams.get('plugin');
        if (plugin) {
            const [pluginName, ...opts] = plugin.split(';');
            outbound.plugin = pluginName;
            if (opts.length) outbound.plugin_opts = opts.join(';');
        }
    }
    return outbound;
}

function parseSocks(link, tag) {
    let cleanLink = link.replace(/^socks(?:5h?)?:\/\//, '');
    const hashIndex = cleanLink.indexOf('#');
    if (hashIndex !== -1) cleanLink = cleanLink.substring(0, hashIndex);

    const atIndex = cleanLink.indexOf('@');
    let username = '';
    let password = '';
    let serverPart = cleanLink;

    if (atIndex !== -1) {
        const authPart = cleanLink.substring(0, atIndex);
        serverPart = cleanLink.substring(atIndex + 1);
        const plainColonIndex = authPart.indexOf(':');
        if (plainColonIndex !== -1) {
            username = decodeURIComponent(authPart.substring(0, plainColonIndex));
            password = decodeURIComponent(authPart.substring(plainColonIndex + 1));
        } else {
            const looksBase64 = /^[A-Za-z0-9+/=_-]+$/.test(authPart);
            if (looksBase64) {
                const decoded = decodeBase64Content(authPart);
                const decodedColonIndex = decoded.indexOf(':');
                if (decodedColonIndex !== -1) {
                    username = decoded.substring(0, decodedColonIndex);
                    password = decoded.substring(decodedColonIndex + 1);
                } else {
                    username = authPart;
                }
            } else {
                username = decodeURIComponent(authPart);
            }
        }
    }

    let address = serverPart;
    let port = 1080;
    try {
        const serverUrl = new URL(`socks://${serverPart}`);
        address = serverUrl.hostname;
        port = serverUrl.port ? parseIntSafe(serverUrl.port, 1080) : 1080;
    } catch (e) {
        const colonIndex = serverPart.lastIndexOf(':');
        address = colonIndex !== -1 ? serverPart.substring(0, colonIndex) : serverPart;
        port = colonIndex !== -1 ? parseIntSafe(serverPart.substring(colonIndex + 1), 1080) : 1080;
    }

    const outbound = {
        type: 'socks',
        tag,
        server: address,
        server_port: port,
        version: '5'
    };
    if (username) outbound.username = username;
    if (password) outbound.password = password;
    return outbound;
}

function parseHttpProxy(link, tag) {
    const urlObj = new URL(link);
    const isTls = link.startsWith('https://');
    const outbound = {
        type: 'http',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port, isTls ? 443 : 80)
    };
    if (urlObj.username) {
        outbound.username = decodeURIComponent(urlObj.username);
        if (urlObj.password) outbound.password = decodeURIComponent(urlObj.password);
    }
    if (isTls) outbound.tls = { enabled: true, server_name: urlObj.hostname };
    return outbound;
}

function parseHysteria2(link, tag) {
    const urlObj = new URL(link);
    const params = urlObj.searchParams;

    const outbound = {
        type: 'hysteria2',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port, 443),
        password: decodeURIComponent(urlObj.username || '') || undefined
    };

    const obfsType = params.get('obfs');
    if (obfsType && obfsType.toLowerCase() !== 'none') {
        outbound.obfs = {
            type: obfsType,
            password: params.get('obfs-password') || params.get('obfsPassword') || ''
        };
    }

    const upMbps = params.get('upmbps') || params.get('up_mbps');
    const downMbps = params.get('downmbps') || params.get('down_mbps');
    if (upMbps) outbound.up_mbps = parseIntSafe(upMbps);
    if (downMbps) outbound.down_mbps = parseIntSafe(downMbps);

    outbound.tls = buildTls({
        serverName: params.get('sni') || urlObj.hostname,
        insecure: params.get('insecure') === '1' || params.get('insecure') === 'true',
        alpn: splitCsv(params.get('alpn')) || ['h3']
    });
    return outbound;
}

function parseTuic(link, tag) {
    const urlObj = new URL(link);
    const params = urlObj.searchParams;

    let uuid = '';
    let password = '';
    if (urlObj.username) {
        const raw = decodeURIComponent(urlObj.username);
        if (urlObj.password) {
            uuid = raw;
            password = decodeURIComponent(urlObj.password);
        } else if (raw.includes(':')) {
            const idx = raw.indexOf(':');
            uuid = raw.substring(0, idx);
            password = raw.substring(idx + 1);
        } else {
            uuid = raw;
        }
    }

    const outbound = {
        type: 'tuic',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port, 443),
        uuid,
        password,
        congestion_control: params.get('congestion_control') || 'cubic',
        udp_relay_mode: params.get('udp_relay_mode') || 'native'
    };

    outbound.tls = buildTls({
        serverName: params.get('sni') || urlObj.hostname,
        insecure: params.get('allow_insecure') === '1' || params.get('insecure') === '1',
        alpn: splitCsv(params.get('alpn')) || ['h3']
    });
    return outbound;
}

function parseSsh(link, tag) {
    const urlObj = new URL(link);
    const outbound = {
        type: 'ssh',
        tag,
        server: urlObj.hostname,
        server_port: parseIntSafe(urlObj.port, 22),
        user: decodeURIComponent(urlObj.username || '')
    };
    if (urlObj.password) outbound.password = decodeURIComponent(urlObj.password);
    return outbound;
}

// Command-line form:
//   ssh [user@]host [-p port] [-i keyfile] [-l user] [password]
// Anything after the `-flag value` pairs and the [user@]host is treated as the
// password (positional). Flags we don't recognize (-o, -J, -L etc.) are skipped
// with the "swallow next arg" logic borrowed from the historical validator.
function parseSshCommand(link, tag) {
    const tokens = link.trim().split(/\s+/).filter(Boolean);
    // tokens[0] is 'ssh'
    let user = '';
    let host = '';
    let port = 22;
    let password = '';
    let keyPath = '';

    const positional = [];
    for (let i = 1; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === '-p' || tok === '-P') { port = parseIntSafe(tokens[++i], 22); continue; }
        if (tok === '-i') { keyPath = tokens[++i] || ''; continue; }
        if (tok === '-l') { user = tokens[++i] || ''; continue; }
        if (['-o', '-J', '-b', '-c', '-D', '-L', '-R', '-W'].includes(tok)) { i++; continue; }
        if (tok.startsWith('-')) continue;
        positional.push(tok);
    }

    // First positional that contains '@' → user@host; otherwise it's the host.
    // Subsequent positional → password.
    for (const tok of positional) {
        if (!host) {
            if (tok.includes('@')) {
                const idx = tok.indexOf('@');
                if (!user) user = tok.substring(0, idx);
                host = tok.substring(idx + 1);
            } else {
                host = tok;
            }
        } else if (!password) {
            password = tok;
        }
    }

    if (!host) throw new Error('SSH command missing host');
    // If the host token also carries `:port`, honor it (unless -p already set).
    if (host.includes(':') && !tokens.some(t => t === '-p' || t === '-P')) {
        const idx = host.lastIndexOf(':');
        const maybePort = parseIntSafe(host.substring(idx + 1), 0);
        if (maybePort) {
            host = host.substring(0, idx);
            port = maybePort;
        }
    }

    const outbound = {
        type: 'ssh',
        tag,
        server: host,
        server_port: port,
        user: user || 'root'
    };
    if (keyPath) outbound.private_key_path = keyPath;
    if (password) outbound.password = password;
    return outbound;
}

// -------------------------------------------------------------------
// Dispatcher
// -------------------------------------------------------------------
function parseProxyLink(link, tag, ctx = {}) {
    link = String(link || '').trim();
    if (!link) throw new Error('Empty proxy link');

    try {
        if (link.startsWith('vmess://')) return parseVmess(link, tag, ctx);
        if (link.startsWith('vless://')) return parseVless(link, tag, ctx);
        if (link.startsWith('trojan://')) return parseTrojan(link, tag, ctx);
        if (link.startsWith('ss://')) return parseShadowsocks(link, tag);
        if (link.startsWith('hysteria2://') || link.startsWith('hy2://')) return parseHysteria2(link, tag);
        if (link.startsWith('tuic://')) return parseTuic(link, tag);
        if (link.startsWith('ssh://')) return parseSsh(link, tag);
        if (/^ssh\s+/i.test(link)) return parseSshCommand(link, tag);
        if (/^socks(?:5h?)?:\/\//.test(link)) return parseSocks(link, tag);
        if (link.startsWith('http://') || link.startsWith('https://')) return parseHttpProxy(link, tag);

        // Bare IP:Port[:User:Pass] → assume socks5
        if (link.includes(':') && !link.includes('://')) {
            const parts = link.split(':');
            const outbound = {
                type: 'socks',
                tag,
                server: parts[0],
                server_port: parseIntSafe(parts[1], 1080),
                version: '5'
            };
            if (parts.length >= 4) {
                outbound.username = parts[2];
                outbound.password = parts[3];
            } else if (parts.length !== 2) {
                throw new Error('Invalid IP:Port:User:Pass format');
            }
            return outbound;
        }
        throw new Error(`Unsupported protocol: ${link.slice(0, 20)}...`);
    } catch (e) {
        console.error('Parse Proxy Error:', link, e.message);
        throw e;
    }
}

// -------------------------------------------------------------------
// uTLS fingerprint derivation (kept concept; adapted to sing-box enum)
// sing-box supports: chrome, firefox, safari, ios, android, edge, 360, qq, random, randomized
// -------------------------------------------------------------------
function deriveUtlsFingerprint(profileFingerprint = {}) {
    if (profileFingerprint.uaMode === 'none') return '';
    const browserType = String(profileFingerprint.browserType || '').toLowerCase();
    if (browserType === 'edge') return 'edge';
    return 'chrome';
}

// -------------------------------------------------------------------
// Config generator
// -------------------------------------------------------------------
function generateSingBoxConfig(mainProxyStr, localPort, preProxyConfig = null, profileFingerprint = null) {
    const utlsFingerprint = deriveUtlsFingerprint(profileFingerprint || {});
    const ctx = { utlsFingerprint };

    const mainOutbound = parseProxyLink(mainProxyStr, 'proxy-main', ctx);

    const outbounds = [
        { type: 'direct', tag: 'direct' }
    ];

    if (preProxyConfig && preProxyConfig.preProxies && preProxyConfig.preProxies.length > 0) {
        try {
            const target = preProxyConfig.preProxies[0];
            const preOutbound = parseProxyLink(target.url, 'proxy-pre', ctx);
            outbounds.push(preOutbound);
            mainOutbound.detour = 'proxy-pre';
        } catch (e) { /* pre-proxy parse failure — skip chain */ }
    }

    outbounds.push(mainOutbound);

    return {
        log: { level: 'warn', timestamp: true },
        inbounds: [{
            type: 'socks',
            tag: 'socks-in',
            listen: '127.0.0.1',
            listen_port: localPort,
            sniff: true,
            sniff_override_destination: false
        }],
        outbounds,
        route: {
            final: 'proxy-main'
        }
    };
}

export { generateSingBoxConfig, parseProxyLink, getProxyRemark };
