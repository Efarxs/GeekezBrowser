#!/usr/bin/env node
// One-off verification for "duplicate profile WITH login state" (feat/duplicate-with-login).
// Flow: launch a throwaway source → plant a persistent cookie via CDP → stop
// (flush to disk) → POST /duplicate?withData=true&keepFingerprint=true →
//   (a) assert source & copy Cookies SQLite files are byte-identical (md5)
//   (b) relaunch the COPY, read cookies via CDP, assert the planted cookie is there
//   (c) assert the copy's fingerprint.fingerprintSeed is frozen to the source's
// Requires: dev running, 设置→远程调试 ON. Cleans up both scratch profiles.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_BASE || 'http://127.0.0.1:12138';
// Dev's real data dir (this machine relocates userData to D:). Override with
// GEEKEZ_DATA if different. Cookies live at Default/Network/Cookies on modern Chrome.
const DATA_PATH = process.env.GEEKEZ_DATA || 'D:\\Users\\12dai\\geekez-browser\\BrowserProfiles';
const COOKIE_SUBPATH = path.join('browser_data', 'Default', 'Network', 'Cookies');
const SRC_NAME = 'ztest-dup-src';
const COPY_NAME = 'ztest-dup-src-copy';
const COOKIE_NAME = 'geekez_dup_proof';
const COOKIE_VALUE = 'proof_' + Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = m => { pass++; console.log(`\x1b[32m✓\x1b[0m ${m}`); };
const bad = (m, d) => { fail++; console.log(`\x1b[31m✗\x1b[0m ${m}`); if (d !== undefined) console.log('   ', typeof d === 'string' ? d : JSON.stringify(d).slice(0, 500)); };

async function api(method, p, body) {
    const res = await fetch(`${API}${p}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    let json; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
}

// Minimal CDP client over a page target.
async function cdp(port) {
    const { WebSocket } = await import('ws');
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
    const tab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || tabs.find(t => t.webSocketDebuggerUrl);
    if (!tab?.webSocketDebuggerUrl) throw new Error('no CDP page target');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('ws open timeout')), 8000);
        ws.once('open', () => { clearTimeout(to); res(); });
        ws.once('error', e => { clearTimeout(to); rej(e); });
    });
    let seq = 0;
    const pending = new Map();
    ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
            msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        }
    });
    const call = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq; pending.set(id, { res, rej });
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`${method} timeout`)); } }, 8000);
        ws.send(JSON.stringify({ id, method, params }));
    });
    return { call, close: () => { try { ws.close(); } catch {} } };
}

async function launch(name) {
    const r = await api('GET', `/api/open/${encodeURIComponent(name)}`);
    if (!r.body?.success) throw new Error(`launch failed: ${JSON.stringify(r.body)}`);
    const port = r.body['remote port'];
    if (!port) throw new Error('no remote port — is 远程调试 on?');
    return port;
}

function md5(file) {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
    console.log(`\n== duplicate-with-login verification ==\nTarget: ${API}\nData:   ${DATA_PATH}\n`);

    // Clean slate
    for (const n of [SRC_NAME, COPY_NAME]) await api('DELETE', `/api/profiles/${encodeURIComponent(n)}`).catch(() => {});

    // 1. Create source
    const created = await api('POST', '/api/profiles', {
        name: SRC_NAME, proxyStr: '',
        fingerprint: { uaMode: 'chrome', browserType: 'Chrome', browserMajorVersion: 148 }
    });
    const srcId = created.body?.profile?.id;
    if (!srcId) return bad('create source', created.body), finish();
    ok(`source created ${srcId.slice(0, 8)}`);

    // 2. Launch, navigate to a real site (organic persistent cookies) + plant a
    //    marker cookie on that real domain, then snapshot the live cookie set.
    const SITE = 'https://www.bing.com';
    let port = await launch(SRC_NAME);
    ok(`source launched, CDP port ${port}`);
    await sleep(2500);
    let c = await cdp(port);
    await c.call('Network.enable');
    await c.call('Page.enable').catch(() => {});
    await c.call('Page.navigate', { url: SITE });
    await sleep(6000); // let the page set its persistent cookies
    await c.call('Network.setCookie', {
        url: SITE, name: COOKIE_NAME, value: COOKIE_VALUE,
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600, path: '/'
    });
    const srcSnap = ((await c.call('Network.getCookies', { urls: [SITE] })).cookies || [])
        .map(x => `${x.name}=${x.value}`).sort();
    const srcMarker = srcSnap.some(s => s === `${COOKIE_NAME}=${COOKIE_VALUE}`);
    (srcMarker && srcSnap.length > 0 ? ok : bad)(`source live cookies captured (${srcSnap.length}, marker present=${srcMarker})`);
    c.close();

    // 3. Let cookies commit to disk, then stop (flush). Chrome's cookie store
    //    commits on a ~30s timer, so wait past it while the browser is running.
    console.log('   waiting 40s for cookie disk-commit (30s timer)…');
    await sleep(40000);
    const srcCookieFile = path.join(DATA_PATH, srcId, COOKIE_SUBPATH);
    const safeMd5 = f => { try { return fs.existsSync(f) ? md5(f).slice(0, 8) : 'none'; } catch (e) { return 'locked'; } };
    const walInfo = f => { try { return fs.existsSync(f + '-wal') ? fs.statSync(f + '-wal').size + 'B' : 'none'; } catch (e) { return 'locked'; } };
    console.log(`   [diag] pre-stop: main md5=${safeMd5(srcCookieFile)}, wal=${walInfo(srcCookieFile)}`);
    await api('POST', `/api/profiles/${encodeURIComponent(SRC_NAME)}/stop`);
    await sleep(3000);
    console.log(`   [diag] post-stop: main md5=${safeMd5(srcCookieFile)}, wal=${walInfo(srcCookieFile)}`);
    if (!fs.existsSync(srcCookieFile)) return bad('source Cookies file exists', srcCookieFile), finish();
    ok(`source Cookies file on disk (${fs.statSync(srcCookieFile).size} bytes)`);

    // 4. Duplicate WITH login state + faithful fingerprint
    const dup = await api('POST', `/api/profiles/${encodeURIComponent(SRC_NAME)}/duplicate?withData=true&keepFingerprint=true`);
    if (!dup.body?.success) return bad('duplicate call', dup.body), finish();
    const copyId = dup.body.profile.id;
    ok(`duplicated → ${copyId.slice(0, 8)} (withData=${dup.body.withData}, keepFp=${dup.body.keepFingerprint}, dataCopied=${dup.body.dataCopied})`);
    (dup.body.dataCopied ? ok : bad)('response reports dataCopied=true', dup.body);

    // 4a. Fingerprint frozen + UA identical?
    const srcFp = created.body.profile.fingerprint;
    const copyProf = await api('GET', `/api/profiles/${encodeURIComponent(copyId)}`);
    const copyFp = copyProf.body?.profile?.fingerprint || {};
    (typeof copyFp.fingerprintSeed === 'number' && copyFp.fingerprintSeed > 0
        ? ok : bad)(`copy carries frozen fingerprintSeed (${copyFp.fingerprintSeed})`, copyFp.fingerprintSeed);
    (copyFp.userAgent === srcFp.userAgent ? ok : bad)('copy UA identical to source', { src: srcFp.userAgent, copy: copyFp.userAgent });

    // 4b. Cookies backing files byte-identical (main DB + WAL)?
    const copyCookieFile = path.join(DATA_PATH, copyId, COOKIE_SUBPATH);
    if (!fs.existsSync(copyCookieFile)) return bad('copy Cookies file exists', copyCookieFile), finish(copyId);
    (md5(srcCookieFile) === md5(copyCookieFile) ? ok : bad)(`Cookies DB byte-identical (${md5(srcCookieFile).slice(0, 8)})`);
    const srcWal = srcCookieFile + '-wal', copyWal = copyCookieFile + '-wal';
    if (fs.existsSync(srcWal)) {
        (fs.existsSync(copyWal) && md5(srcWal) === md5(copyWal) ? ok : bad)('Cookies-wal byte-identical');
    }

    // 5. THE PROOF: launch the COPY, read cookies from the running browser, and
    //    assert its cookie set matches the source's snapshot (values included).
    port = await launch(COPY_NAME);
    ok(`copy launched, CDP port ${port}`);
    await sleep(3000);
    c = await cdp(port);
    await c.call('Network.enable');
    const copySnap = ((await c.call('Network.getCookies', { urls: [SITE] })).cookies || [])
        .map(x => `${x.name}=${x.value}`).sort();
    c.close();
    await api('POST', `/api/profiles/${encodeURIComponent(COPY_NAME)}/stop`);
    await sleep(1500);

    const copyMarker = copySnap.includes(`${COOKIE_NAME}=${COOKIE_VALUE}`);
    (copyMarker ? ok : bad)(`marker cookie carried into running COPY`, copySnap.slice(0, 8));
    const identical = srcSnap.length === copySnap.length && srcSnap.every((v, i) => v === copySnap[i]);
    (identical ? ok : bad)(`COPY cookie set identical to source (src ${srcSnap.length} vs copy ${copySnap.length})`,
        identical ? undefined : { src: srcSnap.slice(0, 8), copy: copySnap.slice(0, 8) });

    await finish(copyId);
}

async function finish(copyId) {
    // Cleanup
    await api('POST', `/api/profiles/${encodeURIComponent(SRC_NAME)}/stop`).catch(() => {});
    if (copyId) await api('POST', `/api/profiles/${encodeURIComponent(COPY_NAME)}/stop`).catch(() => {});
    await sleep(1000);
    for (const n of [SRC_NAME, COPY_NAME]) await api('DELETE', `/api/profiles/${encodeURIComponent(n)}`).catch(() => {});
    console.log(`\n${fail === 0 ? '\x1b[32mALL PASS' : '\x1b[31mFAILURES'}\x1b[0m  pass=${pass} fail=${fail}\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { bad('unexpected', e.message); finish(); });
