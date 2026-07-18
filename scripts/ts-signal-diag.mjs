// Read-only fingerprint diagnostic: measures the passive signals Cloudflare
// Turnstile's interactive variant reads, on a live GeekEZ profile, and prints
// them next to what grok-auto-reg's turnstilePatch forces. Purpose: explain
// why an over-spoofed / random-each-launch profile can be flagged where a
// plain patched Chromium passes. Does NOT touch/solve any challenge.
const API = 'http://127.0.0.1:12138';
const NAME = 'ts-diag';
const PROXY = 'socks5://127.0.0.1:7890'; // clash, just so launch succeeds

async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    let b = null; try { b = await res.json(); } catch {}
    return { status: res.status, body: b };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdpEvalNavigate(port, url, expression, timeoutMs = 25000) {
    const { WebSocket } = await import('ws');
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
    const tab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || tabs.find(t => t.webSocketDebuggerUrl);
    if (!tab?.webSocketDebuggerUrl) throw new Error('no CDP tab');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 0;
    const send = (method, params) => new Promise((res, rej) => {
        const mid = ++id; const to = setTimeout(() => rej(new Error(method + ' timeout')), timeoutMs);
        const on = raw => { let m; try { m = JSON.parse(raw); } catch { return; } if (m.id !== mid) return; clearTimeout(to); ws.off('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
        ws.on('message', on); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    try {
        await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('ws open')), timeoutMs); ws.once('open', () => { clearTimeout(to); res(); }); ws.once('error', rej); });
        await send('Page.enable', {});
        const loaded = new Promise(res => { const on = raw => { let m; try { m = JSON.parse(raw); } catch { return; } if (m.method === 'Page.loadEventFired') { ws.off('message', on); res(); } }; ws.on('message', on); });
        await send('Page.navigate', { url });
        await Promise.race([loaded, sleep(timeoutMs)]);
        await sleep(600);
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        return r?.result?.value;
    } finally { try { ws.close(); } catch {} }
}

const PROBE = `(async () => {
    const out = {};
    out.webdriver = navigator.webdriver;
    out.pluginsLen = navigator.plugins ? navigator.plugins.length : -1;
    out.languages = navigator.languages;
    out.language = navigator.language;
    out.platform = navigator.platform;
    out.ua = navigator.userAgent;
    out.hasChrome = !!window.chrome;
    out.hwConcurrency = navigator.hardwareConcurrency;
    out.deviceMemory = navigator.deviceMemory;
    try { const p = await navigator.permissions.query({name:'notifications'}); out.notifPerm = p.state; out.notifValue = Notification.permission; out.permMismatch = (p.state === 'denied') !== (Notification.permission === 'denied'); } catch(e){ out.notifPerm = 'ERR:'+e.message; }
    try { const c = document.createElement('canvas').getContext('webgl'); const dbg = c.getExtension('WEBGL_debug_renderer_info'); out.webglVendor = c.getParameter(dbg.UNMASKED_VENDOR_WEBGL); out.webglRenderer = c.getParameter(dbg.UNMASKED_RENDERER_WEBGL); } catch(e){ out.webgl = 'ERR:'+e.message; }
    try { const cv = document.createElement('canvas'); cv.width=200;cv.height=50; const x=cv.getContext('2d'); x.textBaseline='top'; x.font='14px Arial'; x.fillText('cf-fp-probe',2,2); out.canvasHash = cv.toDataURL().slice(-32); } catch(e){ out.canvas='ERR:'+e.message; }
    return JSON.stringify(out);
})()`;

async function main() {
    console.log('== GeekEZ Turnstile-signal diagnostic (read-only) ==\n');
    await api('PATCH', '/api/settings', { enableRemoteDebugging: true });
    await api('DELETE', `/api/profiles/${NAME}`).catch(() => {});
    const c = await api('POST', '/api/profiles', {
        name: NAME, proxyStr: PROXY,
        fingerprint: { uaMode: 'spoof', platform: 'Win32', language: 'en-US', timezone: 'America/New_York' },
    });
    if (!c.body?.profile) { console.log('create failed', c.body); return; }
    const open = await api('GET', `/api/open/${NAME}?stream=false`);
    const port = open.body?.['remote port'];
    console.log('launched:', open.body?.success, '| remote port:', port);
    if (!port) { console.log('no CDP port; is remote debugging on?'); await api('DELETE', `/api/profiles/${NAME}`); return; }
    await sleep(3000);
    try {
        const raw = await cdpEvalNavigate(port, 'https://www.cloudflare.com/cdn-cgi/trace', PROBE);
        const s = JSON.parse(raw);
        const rows = [
            ['navigator.webdriver', s.webdriver, 'MUST be false/undefined'],
            ['navigator.plugins.length', s.pluginsLen, 'should be > 0 (0 = bot tell)'],
            ['navigator.languages', JSON.stringify(s.languages), 'non-empty, matches UA'],
            ['navigator.platform', s.platform, 'matches UA (Win32)'],
            ['window.chrome present', s.hasChrome, 'should be true'],
            ['permissions/Notification mismatch', s.permMismatch, 'should be false (classic tell)'],
            ['hardwareConcurrency', s.hwConcurrency, 'realistic (4-16)'],
            ['deviceMemory', s.deviceMemory, 'realistic (4-8)'],
            ['WebGL vendor', s.webglVendor, 'matches platform GPU'],
            ['WebGL renderer', s.webglRenderer, 'matches platform GPU'],
            ['UA', (s.ua || '').slice(0, 70) + '...', ''],
        ];
        console.log('\n--- measured signals ---');
        for (const [k, v, expect] of rows) console.log(`  ${k.padEnd(34)} = ${String(v).padEnd(28)} ${expect ? '(' + expect + ')' : ''}`);
        console.log('\n  canvasHash tail:', s.canvasHash, '(noised by kernel seed → differs per profile)');
    } catch (e) {
        console.log('probe error:', e.message);
    }
    await api('POST', `/api/profiles/${NAME}/stop`).catch(() => {});
    await sleep(1500);
    await api('DELETE', `/api/profiles/${NAME}`).catch(() => {});
}
main().catch(e => console.error(e));
