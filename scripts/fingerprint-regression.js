#!/usr/bin/env node
// Fingerprint regression probe.
//
// Purpose:
//   Before shipping a new fingerprint-chromium kernel version, run this
//   against a freshly-launched profile to verify none of the 30-odd
//   fingerprint dimensions we care about have regressed.
//
// Usage:
//   1. Launch a GeekEZ profile with remote debugging enabled (Settings →
//      Remote Debug on, or add `--remote-debugging-port=24002` to Custom
//      Args on the profile).
//   2. `node tools/fingerprint-regression.js --port 24002 [--out report.json]`
//   3. Read the pass/fail table. Fix any RED before merging kernel bump.
//
// Exits 0 if all critical checks pass, 1 otherwise. Non-critical warnings
// don't fail exit.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const argv = process.argv.slice(2);
function getArg(name, fallback) {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const PORT = Number(getArg('--port', '24002'));
const OUT = getArg('--out', null);
const HOST = '127.0.0.1';

function fetchJson(pathname) {
    return new Promise((resolve, reject) => {
        http.get({ host: HOST, port: PORT, path: pathname }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function connectPage(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    let msgId = 0;
    const pending = new Map();
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve } = pending.get(msg.id);
            pending.delete(msg.id);
            resolve(msg);
        }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = ++msgId;
        pending.set(id, { resolve });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
        const r = await send('Runtime.evaluate', {
            expression: expr, returnByValue: true, awaitPromise: true
        });
        if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
        return r.result?.result?.value;
    };
    return { send, evalJs, close: () => ws.close() };
}

// Each check: { name, category, critical, expect(value): true|false|note }
const CHECKS = [
    {
        name: 'navigator.webdriver',
        critical: true,
        probe: `navigator.webdriver`,
        expect: (v) => v === false ? 'ok' : `webdriver leak: ${v}`
    },
    {
        name: 'navigator.plugins.length',
        critical: true,
        probe: `navigator.plugins.length`,
        // Real Chrome ≥100: 5 built-in plugins (PDF viewers). 0 = headless tell.
        expect: (v) => v >= 3 ? 'ok' : `suspicious plugin count: ${v}`
    },
    {
        name: 'navigator.languages',
        critical: false,
        probe: `JSON.stringify(navigator.languages)`,
        expect: (v) => v && v !== '[]' ? 'ok' : 'empty languages array'
    },
    {
        name: 'navigator.hardwareConcurrency',
        critical: true,
        probe: `navigator.hardwareConcurrency`,
        expect: (v) => v > 0 && v <= 128 ? 'ok' : `weird core count: ${v}`
    },
    {
        name: 'navigator.deviceMemory',
        critical: false,
        probe: `navigator.deviceMemory`,
        expect: (v) => [0.25, 0.5, 1, 2, 4, 8].includes(v) ? 'ok' : `unusual memory: ${v}`
    },
    {
        name: 'screen.width x height',
        critical: true,
        probe: `screen.width + 'x' + screen.height`,
        expect: (v) => /^\d{3,4}x\d{3,4}$/.test(v) ? 'ok' : `weird screen: ${v}`
    },
    {
        name: 'Intl timezone consistency',
        critical: true,
        probe: `(() => {
            const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const offset = new Date().getTimezoneOffset();
            return tzName + '|' + offset;
        })()`,
        expect: (v) => v && v.includes('|') ? 'ok' : `broken tz: ${v}`
    },
    {
        name: 'navigator.mediaDevices',
        critical: false,
        probe: `typeof navigator.mediaDevices !== 'undefined'`,
        expect: (v) => v ? 'ok' : 'mediaDevices missing'
    },
    {
        name: 'permissions API present',
        critical: false,
        probe: `typeof navigator.permissions?.query === 'function'`,
        expect: (v) => v ? 'ok' : 'permissions API missing'
    },
    {
        name: 'notification permission (not denied)',
        critical: true,
        probe: `(async () => {
            try {
                const r = await navigator.permissions.query({ name: 'notifications' });
                return r.state;
            } catch (e) { return 'err:' + e.message; }
        })()`,
        // Headless Chrome returns 'denied' — real Chrome returns 'prompt'.
        expect: (v) => v === 'prompt' || v === 'granted' ? 'ok' : `perm state ${v} (bot tell)`
    },
    {
        name: 'userAgentData.bitness',
        critical: true,
        probe: `(async () => {
            const r = await navigator.userAgentData.getHighEntropyValues(['bitness']);
            return r.bitness;
        })()`,
        expect: (v) => v === '64' ? 'ok' : `bitness=${JSON.stringify(v)} (expected "64")`
    },
    {
        name: 'userAgentData.platform',
        critical: true,
        probe: `(async () => {
            const r = await navigator.userAgentData.getHighEntropyValues(['platform']);
            return r.platform;
        })()`,
        expect: (v) => v && v.length > 0 ? 'ok' : `empty platform: ${JSON.stringify(v)}`
    },
    {
        name: 'userAgentData.platformVersion',
        critical: false,
        probe: `(async () => {
            const r = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
            return r.platformVersion;
        })()`,
        expect: (v) => v && v.length > 0 ? 'ok' : `empty platformVersion: ${JSON.stringify(v)}`
    },
    {
        name: 'WebGL vendor available',
        critical: true,
        probe: `(() => {
            const c = document.createElement('canvas').getContext('webgl');
            if (!c) return 'no-webgl';
            const dbg = c.getExtension('WEBGL_debug_renderer_info');
            if (!dbg) return 'no-debug-ext';
            return c.getParameter(dbg.UNMASKED_VENDOR_WEBGL) + '|' + c.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        })()`,
        expect: (v) => v && !v.startsWith('no-') && v.includes('|') ? 'ok' : `webgl issue: ${v}`
    },
    {
        name: 'canvas.toDataURL entropy',
        critical: true,
        probe: `(() => {
            const cv = document.createElement('canvas');
            cv.width = 100; cv.height = 40;
            const ctx = cv.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = 'rgba(102,204,0,0.7)';
            ctx.fillRect(0, 0, 100, 40);
            ctx.fillStyle = '#069';
            ctx.fillText('GeekEZ-CanvasFP', 2, 2);
            return cv.toDataURL().length;
        })()`,
        // Under 100 = canvas basically blocked / broken.
        expect: (v) => v > 500 ? 'ok' : `canvas output too small (${v} bytes)`
    },
    {
        name: 'AudioContext sampleRate',
        critical: false,
        probe: `(() => {
            try {
                const c = new (window.AudioContext || window.webkitAudioContext)();
                const rate = c.sampleRate;
                c.close();
                return rate;
            } catch (e) { return 'err:' + e.message; }
        })()`,
        expect: (v) => v > 0 ? 'ok' : `audio issue: ${v}`
    },
    {
        name: 'Function.prototype.toString un-detected',
        critical: false,
        probe: `Function.prototype.toString.toString().includes('[native code]')`,
        expect: (v) => v === true ? 'ok' : `toString hook detected`
    },
    {
        name: 'Geolocation.getCurrentPosition native-looking',
        critical: false,
        probe: `(() => {
            try {
                const s = Geolocation.prototype.getCurrentPosition.toString();
                return s.includes('[native code]');
            } catch (e) { return 'err:' + e.message; }
        })()`,
        expect: (v) => v === true ? 'ok' : `geo patch leak: ${v}`
    },
    {
        name: 'no chrome-extension:// visible in scripts',
        critical: false,
        probe: `Array.from(document.scripts).map(s => s.src).some(src => src.startsWith('chrome-extension://'))`,
        expect: (v) => v === false ? 'ok' : 'extension URL leaked to page'
    },
    {
        name: 'WebRTC available',
        critical: false,
        probe: `typeof RTCPeerConnection !== 'undefined'`,
        expect: (v) => v ? 'ok' : 'WebRTC missing (some sites break)'
    }
];

async function main() {
    console.log(`GeekEZ Fingerprint Regression Probe — connecting to ${HOST}:${PORT}`);
    let targets;
    try {
        targets = await fetchJson('/json');
    } catch (e) {
        console.error(`Failed to reach CDP endpoint: ${e.message}`);
        console.error(`Hint: launch a profile with --remote-debugging-port=${PORT} and try again.`);
        process.exit(2);
    }
    // Prefer a real-URL tab — extensions don't inject on chrome://newtab
    // and probes there see un-patched values, producing false FAILs on
    // extension-based patches (Sec-CH-UA-Bitness in particular).
    let page = targets.find(t => t.type === 'page' && t.url && !/^(chrome[-:]|about:)/i.test(t.url));
    if (!page) page = targets.find(t => t.type === 'page');
    if (!page) {
        console.error('No page target found. Open any tab in the profile browser first.');
        process.exit(2);
    }

    const version = await fetchJson('/json/version');
    console.log(`Browser: ${version.Browser}`);
    console.log(`UA: ${version['User-Agent']}\n`);

    const session = await connectPage(page);

    // If we're on a chrome-scheme page, navigate to https://example.com/ so
    // extension content scripts inject before we probe.
    const startUrl = await session.evalJs('location.href');
    if (typeof startUrl === 'string' && /^(chrome[-:]|about:)/i.test(startUrl)) {
        console.log(`  (bootstrapping from ${startUrl} → https://example.com/ for extension injection)`);
        await session.send('Page.enable');
        await session.send('Page.navigate', { url: 'https://example.com/' });
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 250));
            const rs = await session.evalJs('document.readyState');
            if (rs === 'interactive' || rs === 'complete') break;
        }
    }

    const results = [];
    for (const check of CHECKS) {
        const value = await session.evalJs(check.probe);
        const verdict = value?.__error
            ? `probe-error: ${value.__error}`
            : check.expect(value);
        const ok = verdict === 'ok';
        results.push({
            name: check.name,
            critical: !!check.critical,
            value: value?.__error ? undefined : value,
            verdict,
            ok
        });
        const badge = ok ? '\x1b[32mPASS\x1b[0m' : (check.critical ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mWARN\x1b[0m');
        console.log(`  ${badge}  ${check.name}${ok ? '' : ' — ' + verdict}`);
    }
    session.close();

    const critFail = results.filter(r => !r.ok && r.critical);
    const warns = results.filter(r => !r.ok && !r.critical);
    console.log(`\nSummary: ${results.length - critFail.length - warns.length} PASS, ${critFail.length} FAIL (critical), ${warns.length} WARN`);

    if (OUT) {
        fs.writeFileSync(path.resolve(OUT), JSON.stringify({
            browser: version.Browser,
            ua: version['User-Agent'],
            timestamp: new Date().toISOString(),
            results,
            summary: {
                pass: results.length - critFail.length - warns.length,
                critical_fail: critFail.length,
                warn: warns.length
            }
        }, null, 2));
        console.log(`Report saved: ${OUT}`);
    }

    process.exit(critFail.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
