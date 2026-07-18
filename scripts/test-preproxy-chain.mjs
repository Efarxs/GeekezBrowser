// E2E: per-profile inline pre-proxy (preProxyStr) chain stability.
//
// Scenario mirrors the real use case that motivated the feature: the main
// proxy (1024proxy US-Oregon) is NOT reachable directly from here — it must
// be reached THROUGH a pre-proxy (local Clash at socks5://127.0.0.1:7890).
// Each profile carries its own inline preProxyStr, which must:
//   1. bypass the (currently dead) global pre-proxy pool,
//   2. build the sing-box chain  Chrome → Clash → 1024proxy → internet,
//   3. do so reliably across many launches / many nodes.
//
// Needs: dev running, Clash up on 7890, remote debugging enabled.
// Usage: node scripts/test-preproxy-chain.mjs

const API = process.env.API_BASE || 'http://127.0.0.1:12138';
const PRE = 'socks5://127.0.0.1:7890';

const NODES = [
    'socks5://nvjq43847-region-US-st-Oregon-sid-wcFQs1VU-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-7b29MM62-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-eFjP3c3x-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-b8n3Q5MF-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-qZcTNNQc-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-aFtNFKqh-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-C6Fi3KG7-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-Aid7y4E6-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-ZhrW8BDC-t-5:h1xpukrc@us.1024proxy.io:3000',
    'socks5://nvjq43847-region-US-st-Oregon-sid-p2iGza5g-t-5:h1xpukrc@us.1024proxy.io:3000',
];

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`\x1b[32m✓\x1b[0m ${m}`); };
const bad = (m, d) => { failures.push(m); console.log(`\x1b[31m✗\x1b[0m ${m}`); if (d !== undefined) console.log('    ' + JSON.stringify(d).slice(0, 260)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    let b = null;
    try { b = await res.json(); } catch { /* non-json */ }
    return { status: res.status, body: b };
}

async function cdpEval(port, expression, timeoutMs = 20000) {
    const { WebSocket } = await import('ws');
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
    const tab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || tabs.find(t => t.webSocketDebuggerUrl);
    if (!tab?.webSocketDebuggerUrl) throw new Error('no CDP tab with debugger URL');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    try {
        await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('ws open timeout')), timeoutMs);
            ws.once('open', () => { clearTimeout(to); res(); });
            ws.once('error', (e) => { clearTimeout(to); rej(e); });
        });
        const id = 1;
        return await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('Runtime.evaluate timeout')), timeoutMs);
            ws.on('message', (raw) => {
                let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
                if (msg.id !== id) return;
                clearTimeout(to);
                if (msg.error) return rej(new Error(msg.error.message || 'CDP error'));
                res(msg.result?.result?.value);
            });
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
        });
    } finally { try { ws.close(); } catch { /* closed */ } }
}

// Navigate the tab to a real 200 page through the proxy chain and read the
// body. Top-level navigation avoids the CORS/CSP wall you hit fetching from
// the chrome://new-tab page (a 204 verify probe leaves the tab there).
async function cdpNavigateAndRead(port, url, timeoutMs = 30000) {
    const { WebSocket } = await import('ws');
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
    const tab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || tabs.find(t => t.webSocketDebuggerUrl);
    if (!tab?.webSocketDebuggerUrl) throw new Error('no CDP tab with debugger URL');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let nextId = 1;
    const send = (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        const to = setTimeout(() => rej(new Error(`${method} timeout`)), timeoutMs);
        const onMsg = (raw) => {
            let m; try { m = JSON.parse(raw.toString()); } catch { return; }
            if (m.id !== id) return;
            clearTimeout(to); ws.off('message', onMsg);
            if (m.error) return rej(new Error(m.error.message || method + ' error'));
            res(m.result);
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
    });
    try {
        await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('ws open timeout')), timeoutMs);
            ws.once('open', () => { clearTimeout(to); res(); });
            ws.once('error', (e) => { clearTimeout(to); rej(e); });
        });
        await send('Page.enable', {});
        const loaded = new Promise((res) => {
            const onMsg = (raw) => {
                let m; try { m = JSON.parse(raw.toString()); } catch { return; }
                if (m.method === 'Page.loadEventFired') { ws.off('message', onMsg); res(); }
            };
            ws.on('message', onMsg);
        });
        await send('Page.navigate', { url });
        await Promise.race([loaded, sleep(timeoutMs)]);
        await sleep(800); // let JSON body settle
        const r = await send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true });
        return r?.result?.value || '';
    } finally { try { ws.close(); } catch { /* closed */ } }
}

const NAME = (i) => `e2e-preproxy-${String(i).padStart(2, '0')}`;

async function cleanup() {
    for (let i = 0; i < NODES.length; i++) await api('DELETE', `/api/profiles/${NAME(i)}`).catch(() => { });
}

async function main() {
    console.log(`\n== per-profile pre-proxy chain E2E ==`);
    console.log(`Target: ${API}   Pre-proxy: ${PRE}\n`);

    // Ensure remote debugging is on (needed for the CDP exit-IP check).
    await api('PATCH', '/api/settings', { enableRemoteDebugging: true });

    await cleanup();

    // ── Phase 1: chain routing via /api/proxy/latency for ALL 10 nodes.
    // Direct connection to 1024proxy fails from here; success proves the
    // inline pre-proxy (Clash) is carrying the traffic.
    console.log('── Phase 1: chain latency (10 nodes, inline pre-proxy) ──');
    const created = [];
    for (let i = 0; i < NODES.length; i++) {
        const c = await api('POST', '/api/profiles', {
            name: NAME(i),
            proxyStr: NODES[i],
            preProxyStr: PRE,
            fingerprint: { platform: 'Win32', language: 'en-US', timezone: 'America/Los_Angeles' },
        });
        if (c.body?.profile?.preProxyStr === PRE) created.push(i);
        else bad(`node ${i}: create/persist preProxyStr`, c.body);
    }
    if (created.length === NODES.length) ok(`created ${created.length}/10 profiles with inline preProxyStr`);

    let latOk = 0;
    for (let i = 0; i < NODES.length; i++) {
        const lat = await api('POST', '/api/proxy/latency', { profileId: NAME(i) });
        const usedInline = lat.body?.chain?.preProxy === 'profile';
        if (lat.body?.success && usedInline) { latOk++; console.log(`   node ${i}: ${lat.body.latencyMs}ms  (chain via inline pre-proxy)`); }
        else bad(`node ${i}: chain latency`, lat.body);
    }
    if (latOk === NODES.length) ok(`chain latency 10/10 nodes succeeded through inline pre-proxy`);
    else bad(`chain latency only ${latOk}/10 succeeded`);

    // ── Phase 2: full browser launch + CDP exit-IP (first 3 nodes, headless).
    console.log('\n── Phase 2: browser launch + CDP exit IP (3 nodes) ──');
    const exitIps = [];
    for (let i = 0; i < 3; i++) {
        // headless, NOT clean (clean suppresses the CDP port).
        await api('PUT', `/api/profiles/${NAME(i)}`, { headless: true });
        const open = await api('GET', `/api/open/${NAME(i)}?verify=browser`);
        if (open.status !== 200 || !open.body?.success) { bad(`node ${i}: /api/open (chain launch)`, open.body); continue; }
        const port = open.body['remote port'];
        if (!port) { bad(`node ${i}: no remote port`, open.body); await api('POST', `/api/profiles/${NAME(i)}/stop`).catch(() => {}); continue; }
        try {
            // Top-level navigation to a real 200 JSON page through the chain.
            const raw = await cdpNavigateAndRead(port, 'https://api.ipify.org/?format=json');
            let parsed = null; try { parsed = JSON.parse(raw); } catch { /* */ }
            const ip = parsed?.ip;
            const isPublicV4 = ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
            if (isPublicV4) {
                exitIps.push(ip);
                ok(`node ${i}: exit IP ${ip} via chain (Chrome → Clash → 1024proxy)`);
            } else {
                bad(`node ${i}: unexpected exit`, raw.slice(0, 200));
            }
        } catch (e) {
            bad(`node ${i}: CDP exit-IP read`, e.message);
        }
        await api('POST', `/api/profiles/${NAME(i)}/stop`).catch(() => { });
        await sleep(1500);
    }
    if (exitIps.length >= 2 && new Set(exitIps).size >= 2) ok(`distinct exit IPs across nodes (${[...new Set(exitIps)].join(', ')}) — per-node routing works`);
    else if (exitIps.length) console.log(`   note: exit IPs = ${exitIps.join(', ')} (sticky-session may reuse IPs; not a failure)`);

    // ── Phase 3: stability loop — same node, N repeats, expect 100%.
    console.log('\n── Phase 3: stability (node 0 × 10 chain probes) ──');
    let stable = 0;
    for (let r = 0; r < 10; r++) {
        const lat = await api('POST', '/api/proxy/latency', { profileId: NAME(0) });
        if (lat.body?.success && lat.body?.chain?.preProxy === 'profile') stable++;
        process.stdout.write(lat.body?.success ? '\x1b[32m.\x1b[0m' : '\x1b[31mx\x1b[0m');
    }
    console.log('');
    if (stable === 10) ok(`stability 10/10 — chain is reliable`);
    else bad(`stability only ${stable}/10`);

    await cleanup();

    console.log(`\n== Summary ==`);
    console.log(`\x1b[32mPassed:\x1b[0m ${pass}`);
    console.log(`\x1b[31mFailed:\x1b[0m ${failures.length}`);
    if (failures.length) { failures.forEach(f => console.log(' · ' + f)); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
