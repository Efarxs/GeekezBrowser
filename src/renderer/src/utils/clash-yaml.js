// Clash / Mihomo YAML subscription parser.
//
// Converts each entry in a Clash config's `proxies:` array to the URI-list
// format that our existing sing-box outbound parser (src/main/utils.js:
// parseProxyLink) already understands. That way YAML subscriptions
// plumb through the same code path as plain URI-list subscriptions with
// no changes on the sing-box side.
//
// Supported Clash proxy types: vmess, vless, trojan, ss, hysteria2,
// socks5, http. Types outside this set are silently skipped (with a
// console warning) so a mixed subscription still imports the parts we
// can render.

import yaml from 'js-yaml';

const b64 = (s) => btoa(unescape(encodeURIComponent(String(s ?? ''))));

// Fast-path detection so callers can auto-route to this parser.
export function looksLikeClashYaml(text) {
    if (!text || typeof text !== 'string') return false;
    // The `proxies:` key is the load-bearing marker in every Clash /
    // Mihomo config and rarely appears in URI-list content.
    return /^\s*proxies\s*:/m.test(text);
}

export function parseClashYamlToUriList(text) {
    let doc;
    try {
        doc = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
        // FAILSAFE_SCHEMA keeps everything as strings — but Clash configs
        // rely on JS-native types for booleans and numbers, so re-parse
        // with the default schema if the first pass looks unusable.
        if (!doc || typeof doc !== 'object') doc = yaml.load(text);
    } catch (e) {
        // Retry once with the default schema in case FAILSAFE choked
        // on custom tags (Mihomo has none, but subconverter outputs
        // sometimes carry `!!` type hints).
        try { doc = yaml.load(text); } catch (e2) { return []; }
    }
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.proxies)) return [];

    const uris = [];
    for (const p of doc.proxies) {
        if (!p || typeof p !== 'object') continue;
        const uri = encodeClashProxy(p);
        if (uri) uris.push(uri);
        else console.warn('[Clash YAML] skipped unsupported proxy:', p.name, p.type);
    }
    return uris;
}

function encodeClashProxy(p) {
    const type = String(p.type || '').toLowerCase();
    const name = String(p.name || '').trim();
    const nameFragment = name ? `#${encodeURIComponent(name)}` : '';

    switch (type) {
        case 'vmess':   return encodeVmess(p);
        case 'vless':   return encodeVless(p, nameFragment);
        case 'trojan':  return encodeTrojan(p, nameFragment);
        case 'ss':
        case 'shadowsocks':
                        return encodeSs(p, nameFragment);
        case 'hysteria2':
        case 'hy2':     return encodeHysteria2(p, nameFragment);
        case 'tuic':    return encodeTuic(p, nameFragment);
        case 'socks5':
        case 'socks':   return encodeSocks(p, nameFragment);
        case 'http':
        case 'https':   return encodeHttp(p, nameFragment);
        default:        return null;
    }
}

// vmess URI = "vmess://" + base64 of a JSON blob (v2rayN dialect).
function encodeVmess(p) {
    const wsOpts = p['ws-opts'] || p.ws_opts || {};
    const grpcOpts = p['grpc-opts'] || p.grpc_opts || {};
    const h2Opts = p['h2-opts'] || p.h2_opts || {};
    const httpOpts = p['http-opts'] || p.http_opts || {};

    const net = String(p.network || 'tcp').toLowerCase();
    let path = '';
    let host = '';
    if (net === 'ws') {
        path = wsOpts.path || '';
        host = (wsOpts.headers && (wsOpts.headers.Host || wsOpts.headers.host)) || '';
    } else if (net === 'grpc') {
        path = grpcOpts['grpc-service-name'] || grpcOpts.serviceName || '';
    } else if (net === 'h2') {
        path = Array.isArray(h2Opts.path) ? h2Opts.path[0] : (h2Opts.path || '');
        host = Array.isArray(h2Opts.host) ? h2Opts.host[0] : (h2Opts.host || '');
    } else if (net === 'http') {
        path = Array.isArray(httpOpts.path) ? httpOpts.path[0] : (httpOpts.path || '');
        host = Array.isArray(httpOpts.headers?.Host) ? httpOpts.headers.Host[0] : (httpOpts.headers?.Host || '');
    }

    const blob = {
        v: '2',
        ps: String(p.name || ''),
        add: String(p.server || ''),
        port: String(p.port || ''),
        id: String(p.uuid || ''),
        aid: String(p.alterId ?? p['alter-id'] ?? 0),
        scy: String(p.cipher || 'auto'),
        net,
        type: 'none',
        host: String(host || ''),
        path: String(path || ''),
        tls: p.tls ? 'tls' : '',
        sni: String(p.servername || p.sni || '')
    };
    return `vmess://${b64(JSON.stringify(blob))}`;
}

function encodeVless(p, nameFragment) {
    const params = new URLSearchParams();
    const net = String(p.network || 'tcp').toLowerCase();
    params.set('type', net);

    const tls = !!p.tls;
    const reality = p['reality-opts'] || p.reality_opts;
    if (reality) {
        params.set('security', 'reality');
        if (reality['public-key']) params.set('pbk', reality['public-key']);
        if (reality['short-id']) params.set('sid', reality['short-id']);
    } else if (tls) {
        params.set('security', 'tls');
    }
    if (p['client-fingerprint']) params.set('fp', p['client-fingerprint']);
    if (p.flow) params.set('flow', p.flow);
    if (p.servername || p.sni) params.set('sni', p.servername || p.sni);

    if (net === 'ws') {
        const ws = p['ws-opts'] || p.ws_opts || {};
        if (ws.path) params.set('path', ws.path);
        const hostHeader = ws.headers && (ws.headers.Host || ws.headers.host);
        if (hostHeader) params.set('host', hostHeader);
    } else if (net === 'grpc') {
        const grpc = p['grpc-opts'] || p.grpc_opts || {};
        if (grpc['grpc-service-name']) params.set('serviceName', grpc['grpc-service-name']);
    }

    return `vless://${encodeURIComponent(p.uuid)}@${p.server}:${p.port}?${params}${nameFragment}`;
}

function encodeTrojan(p, nameFragment) {
    const params = new URLSearchParams();
    const net = String(p.network || 'tcp').toLowerCase();
    if (net !== 'tcp') params.set('type', net);
    if (p.sni || p.servername) params.set('sni', p.sni || p.servername);
    if (p['skip-cert-verify']) params.set('allowInsecure', '1');
    if (p['client-fingerprint']) params.set('fp', p['client-fingerprint']);
    if (net === 'ws') {
        const ws = p['ws-opts'] || p.ws_opts || {};
        if (ws.path) params.set('path', ws.path);
        const hostHeader = ws.headers && (ws.headers.Host || ws.headers.host);
        if (hostHeader) params.set('host', hostHeader);
    }
    const qs = params.toString();
    return `trojan://${encodeURIComponent(p.password)}@${p.server}:${p.port}${qs ? '?' + qs : ''}${nameFragment}`;
}

function encodeSs(p, nameFragment) {
    // SIP002 form: ss://base64(method:password)@host:port#name
    const userInfo = b64(`${p.cipher}:${p.password}`);
    return `ss://${userInfo}@${p.server}:${p.port}${nameFragment}`;
}

function encodeHysteria2(p, nameFragment) {
    const params = new URLSearchParams();
    if (p.sni) params.set('sni', p.sni);
    if (p['skip-cert-verify']) params.set('insecure', '1');
    if (p.obfs) params.set('obfs', p.obfs);
    if (p['obfs-password']) params.set('obfs-password', p['obfs-password']);
    const qs = params.toString();
    return `hy2://${encodeURIComponent(p.password)}@${p.server}:${p.port}${qs ? '?' + qs : ''}${nameFragment}`;
}

function encodeTuic(p, nameFragment) {
    // TUIC v5 URI: tuic://uuid:password@host:port?sni=&alpn=&congestion_control=&udp_relay_mode=
    const auth = `${encodeURIComponent(p.uuid || '')}:${encodeURIComponent(p.password || '')}`;
    const params = new URLSearchParams();
    if (p.sni) params.set('sni', p.sni);
    if (p['skip-cert-verify']) params.set('insecure', '1');
    const alpn = Array.isArray(p.alpn) ? p.alpn.join(',') : p.alpn;
    if (alpn) params.set('alpn', alpn);
    if (p['congestion-controller']) params.set('congestion_control', p['congestion-controller']);
    if (p['udp-relay-mode']) params.set('udp_relay_mode', p['udp-relay-mode']);
    const qs = params.toString();
    return `tuic://${auth}@${p.server}:${p.port}${qs ? '?' + qs : ''}${nameFragment}`;
}

function encodeSocks(p, nameFragment) {
    const auth = p.username
        ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@`
        : '';
    return `socks5://${auth}${p.server}:${p.port}${nameFragment}`;
}

function encodeHttp(p, nameFragment) {
    const auth = p.username
        ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@`
        : '';
    const scheme = p.tls ? 'https' : 'http';
    return `${scheme}://${auth}${p.server}:${p.port}${nameFragment}`;
}
