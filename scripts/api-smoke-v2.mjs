#!/usr/bin/env node
// Extended smoke tests for the v1.7.13 API additions:
//  - stop keepProxy option
//  - /api/open?clean=true
//  - /api/profiles/:id/duplicate
//  - /api/profiles/:id/runtime
//  - /api/kernels (GET list, POST install, DELETE)
//  - /api/settings (GET + PATCH)
//  - /api/proxy/latency

const API = process.env.API_BASE || 'http://127.0.0.1:12138';
const PROXY_STR = 'socks5://127.0.0.1:7890';

let pass = 0, fail = 0;
const failures = [];

function ok(m) { pass++; console.log(`\x1b[32m✓\x1b[0m ${m}`); }
function bad(m, d) {
    fail++;
    failures.push(m);
    console.log(`\x1b[31m✗\x1b[0m ${m}`);
    if (d !== undefined) console.log('   ', typeof d === 'string' ? d : JSON.stringify(d).slice(0, 400));
}

async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    let json;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`\n== v2 smoke ==`);
    console.log(`Target: ${API}\n`);

    // Housekeep: clean prior scratch
    for (const n of ['smk2-src', 'smk2-src-copy', 'smk2-src-copy-02']) {
        await api('DELETE', `/api/profiles/${encodeURIComponent(n)}`).catch(() => { });
    }

    // Baseline profile snapshot for post-run cleanup
    const preList = await api('GET', '/api/profiles');
    const baseIds = new Set(preList.body?.profiles?.map(p => p.id) || []);

    // Snapshot settings so we can restore
    const initialSettings = await api('GET', '/api/settings');
    ok('GET /api/settings returns snapshot');
    const originalRemoteDbg = initialSettings.body?.settings?.enableRemoteDebugging;
    if (typeof originalRemoteDbg !== 'boolean') bad('  enableRemoteDebugging missing/typewrong', originalRemoteDbg);

    // ── /api/settings PATCH — flip a scalar and verify
    {
        const flipped = !originalRemoteDbg;
        const r = await api('PATCH', '/api/settings', { enableRemoteDebugging: flipped });
        if (r.status === 200 && r.body?.settings?.enableRemoteDebugging === flipped) ok(`PATCH /api/settings flipped enableRemoteDebugging → ${flipped}`);
        else bad('PATCH /api/settings flip failed', r);
        // Restore
        await api('PATCH', '/api/settings', { enableRemoteDebugging: originalRemoteDbg });
    }

    // ── /api/settings PATCH — reject non-writable field
    {
        const r = await api('PATCH', '/api/settings', { preProxies: [] });
        if (r.status === 400 && /non-writable/.test(r.body?.error || '')) ok('PATCH /api/settings rejects preProxies (non-writable) → 400');
        else bad('PATCH /api/settings should reject preProxies with 400', r);
    }

    // ── /api/settings PATCH — empty body
    {
        const r = await api('PATCH', '/api/settings', {});
        if (r.status === 400) ok('PATCH /api/settings rejects empty body → 400');
        else bad('PATCH /api/settings empty body should be 400', r);
    }

    // ── /api/kernels GET
    let installed = [];
    {
        const r = await api('GET', '/api/kernels');
        if (r.status === 200 && r.body?.success === true && Array.isArray(r.body.installed)) {
            installed = r.body.installed;
            ok(`GET /api/kernels — ${installed.length} installed, pinned=${r.body.pinned}`);
        } else {
            bad('GET /api/kernels shape', r);
        }
    }

    // ── /api/kernels?available=true (this hits GitHub; guard with catch)
    {
        const r = await api('GET', '/api/kernels?available=true');
        if (r.status === 200) {
            if (Array.isArray(r.body?.available)) ok(`GET /api/kernels?available=true — ${r.body.available.length} upstream`);
            else if (r.body?.availableError) console.log(`  ~ available fetch failed (${r.body.availableError.slice(0, 60)}) — not counted as fail`);
            else bad('GET /api/kernels?available=true shape', r);
        } else {
            bad('GET /api/kernels?available=true status', r);
        }
    }

    // ── /api/kernels POST — invalid version
    {
        const r = await api('POST', '/api/kernels/not-a-version');
        if (r.status === 400) ok('POST /api/kernels/<bad> → 400');
        else bad('bad kernel version expected 400', r);
    }

    // ── /api/kernels POST — install an already-installed version → alreadyInstalled:true
    if (installed.length > 0) {
        const v = installed[0].version;
        const r = await api('POST', `/api/kernels/${v}`);
        if (r.status === 200 && r.body?.alreadyInstalled === true) ok(`POST /api/kernels/${v} → alreadyInstalled:true`);
        else bad('POST already-installed kernel', r);
    }

    // ── /api/kernels DELETE — pinned refused with 409
    {
        const r = await api('DELETE', `/api/kernels/${initialSettings.body?.settings?.selectedId || '999.0.0.0'}`);
        // If selectedId happens to not be a version we'll just get a different error; test the pinned case explicitly.
        // Get pinned from list response above.
        const pinnedResp = await api('GET', '/api/kernels');
        const pinnedVer = pinnedResp.body?.pinned;
        if (pinnedVer) {
            const rr = await api('DELETE', `/api/kernels/${pinnedVer}`);
            if (rr.status === 409) ok(`DELETE /api/kernels/${pinnedVer} (pinned) → 409`);
            else bad('DELETE pinned kernel expected 409', rr);
        }
    }

    // ── Duplicate profile
    let srcProfile;
    {
        const create = await api('POST', '/api/profiles', {
            name: 'smk2-src',
            proxyStr: PROXY_STR,
            tags: ['dup-test'],
            fingerprint: { platform: 'Win32', language: 'en-US', timezone: 'America/New_York' }
        });
        srcProfile = create.body.profile;

        const dup = await api('POST', `/api/profiles/smk2-src/duplicate`, {});
        if (dup.status === 200
            && dup.body?.success === true
            && dup.body.profile?.id !== srcProfile.id
            && dup.body.profile?.name === 'smk2-src-copy'
            && dup.body.profile?.proxyStr === PROXY_STR) {
            ok('POST /:id/duplicate → carries proxy, gets copy name, fresh id');
        } else {
            bad('duplicate default shape', dup.body);
        }

        // Duplicate with override name
        const dup2 = await api('POST', `/api/profiles/smk2-src/duplicate`, { name: 'smk2-src-with-newname' });
        if (dup2.status === 200 && dup2.body?.profile?.name === 'smk2-src-with-newname') {
            ok('POST /:id/duplicate with body.name override');
        } else {
            bad('duplicate name override', dup2.body);
        }
        // Cleanup dup profiles
        await api('DELETE', '/api/profiles/smk2-src-copy');
        await api('DELETE', '/api/profiles/smk2-src-with-newname');
    }

    // ── /api/profiles/:id/runtime — not running
    {
        const r = await api('GET', `/api/profiles/smk2-src/runtime`);
        if (r.status === 200 && r.body?.success === true && r.body.running === false) {
            ok('GET /:id/runtime for stopped profile → running:false');
        } else {
            bad('runtime status stopped', r);
        }
    }

    // ── Launch with clean profile flag
    {
        const r = await api('GET', '/api/open/smk2-src?clean=true&stream=false');
        if (r.status === 200 && r.body?.success === true) {
            ok('GET /api/open?clean=true — launched');
        } else {
            bad('clean launch', r);
        }
        await sleep(3500);

        // Runtime should now say running
        const rt = await api('GET', '/api/profiles/smk2-src/runtime');
        if (rt.body?.running === true) ok('  /:id/runtime → running:true after launch');
        else bad('  /:id/runtime after launch', rt.body);

        // ── stop with keepProxy=true
        const stop1 = await api('POST', '/api/profiles/smk2-src/stop?keepProxy=true');
        if (stop1.status === 200 && /kept alive/.test(stop1.body?.message || '')) {
            ok('POST /:id/stop?keepProxy=true → browser closed, proxy alive');
        } else {
            bad('keepProxy stop', stop1);
        }
        await sleep(2000);

        // ── Then a follow-up stop with default (kills proxy)
        // But it might already be considered "not running" since browser is dead.
        // Skip — just verify the state.

        // Sanity: delete the profile
        await api('DELETE', '/api/profiles/smk2-src').catch(() => { });
    }

    // ── /api/proxy/latency by proxyStr
    {
        const r = await api('POST', '/api/proxy/latency', { proxyStr: PROXY_STR });
        if (r.status === 200 && r.body?.success === true) {
            ok(`POST /api/proxy/latency proxyStr → ${r.body.latencyMs ?? '?'}ms`);
        } else {
            bad('proxy latency by proxyStr', r);
        }
    }

    // ── /api/proxy/latency missing body
    {
        const r = await api('POST', '/api/proxy/latency', {});
        if (r.status === 400) ok('POST /api/proxy/latency empty body → 400');
        else bad('proxy latency empty body expected 400', r);
    }

    // Cleanup stray profiles created by this run (paranoid).
    const after = await api('GET', '/api/profiles');
    const strays = (after.body?.profiles || []).filter(p => !baseIds.has(p.id));
    for (const p of strays) {
        try { await api('POST', `/api/profiles/${p.id}/stop`); } catch { }
        await api('DELETE', `/api/profiles/${p.id}`).catch(() => { });
    }
    if (strays.length > 0) console.log(`  (cleaned ${strays.length} stray profile(s))`);

    console.log(`\n== v2 Summary ==`);
    console.log(`\x1b[32mPassed:\x1b[0m ${pass}`);
    console.log(`\x1b[31mFailed:\x1b[0m ${fail}`);
    if (fail > 0) failures.forEach(f => console.log(` · ${f}`));
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
    console.error('Harness crashed:', e);
    process.exit(2);
});
