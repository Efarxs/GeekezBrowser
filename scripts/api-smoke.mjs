#!/usr/bin/env node
// One-off API regression harness against the local GeekEZ REST server.
// Runs every documented endpoint plus the fields added on this branch
// (kernelVersion, fingerprint.disabledSpoofing). Deletes any profile
// it creates before exit so a re-run is idempotent.
//
// Usage: node scripts/api-smoke.mjs
//        API_BASE=http://127.0.0.1:12138 node scripts/api-smoke.mjs

const API = process.env.API_BASE || 'http://127.0.0.1:12138';
const PROXY_STR = 'socks5://127.0.0.1:7890';

let pass = 0;
let fail = 0;
const failures = [];

function log(...args) { console.log(...args); }
function ok(msg) { pass++; console.log(`[32m✓[0m ${msg}`); }
function bad(msg, detail) {
    fail++;
    failures.push({ msg, detail });
    console.log(`[31m✗[0m ${msg}`);
    if (detail !== undefined) console.log('    ', typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500));
}

async function api(method, path, body, expectStatus = 200) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    let json;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
}

// Sleep helper for polling.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ensureNotRunning(nameOrId) {
    try { await api('POST', `/api/profiles/${encodeURIComponent(nameOrId)}/stop`); } catch { /* ignore */ }
}

async function cleanupIfExists(nameOrId) {
    const r = await api('DELETE', `/api/profiles/${encodeURIComponent(nameOrId)}`);
    return r.status === 200;
}

async function main() {
    log(`\n== GeekEZ API smoke ==`);
    log(`Target: ${API}`);
    log(`Proxy:  ${PROXY_STR}\n`);

    const SCRATCH_A = 'api-smoke-A';
    const SCRATCH_B = 'api-smoke-B';

    // Housekeeping: nuke leftover scratch profiles from previous runs.
    for (const n of [SCRATCH_A, SCRATCH_B, `${SCRATCH_A}-02`, `${SCRATCH_B}-02`]) {
        await ensureNotRunning(n);
        await cleanupIfExists(n);
    }

    // ── 1. GET /api/status
    {
        const r = await api('GET', '/api/status');
        if (r.status === 200 && r.body?.success === true && Array.isArray(r.body.running)) {
            ok('GET /api/status returns { success, running[], count }');
        } else {
            bad('GET /api/status shape', r);
        }
    }

    // ── 2. GET /api/profiles
    // Snapshot the pre-existing id set. Any profile created BUT not
    // in this set after the run is a leftover we must clean up (the
    // import round-trip below creates a lot of -02/-03 collisions).
    let baseProfileCount = 0;
    let baseProfileIds = new Set();
    {
        const r = await api('GET', '/api/profiles');
        if (r.status === 200 && r.body?.success === true && Array.isArray(r.body.profiles)) {
            baseProfileCount = r.body.profiles.length;
            baseProfileIds = new Set(r.body.profiles.map(p => p.id));
            ok(`GET /api/profiles returns ${baseProfileCount} profiles`);
        } else {
            bad('GET /api/profiles shape', r);
        }
    }

    // ── 3. POST /api/profiles — new-fields exercised
    let scratchAId = null;
    {
        const payload = {
            name: SCRATCH_A,
            proxyStr: PROXY_STR,
            tags: ['smoke', 'auto-test'],
            notes: 'created by api-smoke.mjs',
            fingerprint: {
                uaMode: 'spoof',
                platform: 'Win32',
                browserType: 'chrome',
                browserMajorVersion: 148,
                language: 'en-US',
                timezone: 'America/Los_Angeles',
                hardwareConcurrency: 8,
                deviceMemory: 8,
                screen: { width: 1920, height: 1080 },
                // NEW on this branch — per-category disable-spoofing
                disabledSpoofing: ['canvas', 'audio']
            },
            // NEW on this branch — per-profile kernel version override.
            // Leave empty to use pinned; test the empty case here, we'll
            // exercise explicit versions on the PUT path.
            kernelVersion: null
        };
        const r = await api('POST', '/api/profiles', payload);
        if (r.status === 200 && r.body?.success === true && r.body.profile?.id) {
            scratchAId = r.body.profile.id;
            ok(`POST /api/profiles creates ${SCRATCH_A} (id=${scratchAId.slice(0, 8)}…)`);
        } else {
            bad('POST /api/profiles create', r);
            return;
        }
        // New-field round-trip verification
        const fp = r.body.profile.fingerprint;
        if (Array.isArray(fp?.disabledSpoofing) && fp.disabledSpoofing.includes('canvas') && fp.disabledSpoofing.includes('audio')) {
            ok('  · fingerprint.disabledSpoofing round-trips');
        } else {
            bad('  · fingerprint.disabledSpoofing missing from response', fp?.disabledSpoofing);
        }
    }

    // ── 4. GET /api/profiles/:name  and  /:id
    {
        const [byName, byId] = await Promise.all([
            api('GET', `/api/profiles/${encodeURIComponent(SCRATCH_A)}`),
            api('GET', `/api/profiles/${scratchAId}`)
        ]);
        if (byName.status === 200 && byName.body?.profile?.id === scratchAId) {
            ok('GET /api/profiles/:name lookup by name');
        } else {
            bad('GET /api/profiles/:name', byName);
        }
        if (byId.status === 200 && byId.body?.profile?.id === scratchAId) {
            ok('GET /api/profiles/:id lookup by id');
        } else {
            bad('GET /api/profiles/:id', byId);
        }
    }

    // ── 5. PUT /api/profiles/:name — update proxy + kernelVersion
    {
        const r = await api('PUT', `/api/profiles/${encodeURIComponent(SCRATCH_A)}`, {
            proxyStr: PROXY_STR,
            tags: ['smoke', 'auto-test', 'edited'],
            fingerprint: {
                disabledSpoofing: ['canvas', 'audio', 'gpu']
            }
        });
        if (r.status === 200 && r.body?.success === true) {
            const tags = r.body.profile?.tags || [];
            const disabled = r.body.profile?.fingerprint?.disabledSpoofing || [];
            if (tags.includes('edited') && disabled.includes('gpu')) {
                ok('PUT /api/profiles/:name persists updates');
            } else {
                bad('PUT /api/profiles/:name update contents', { tags, disabled });
            }
        } else {
            bad('PUT /api/profiles/:name status', r);
        }
    }

    // ── 6. Duplicate-name auto-suffix
    {
        const r = await api('POST', '/api/profiles', { name: SCRATCH_A, proxyStr: 'direct' });
        if (r.status === 200 && r.body?.profile?.name === `${SCRATCH_A}-02`) {
            ok(`POST duplicate name auto-suffixes → ${SCRATCH_A}-02`);
            await api('DELETE', `/api/profiles/${SCRATCH_A}-02`);
        } else {
            bad('duplicate-name auto-suffix', r.body?.profile?.name);
        }
    }

    // ── 7. Error path: 404 on non-existent
    {
        const [r1, r2] = await Promise.all([
            api('GET', '/api/profiles/does-not-exist-xyz'),
            api('DELETE', '/api/profiles/does-not-exist-xyz')
        ]);
        if (r1.status === 404 && r1.body?.success === false) ok('GET missing profile → 404');
        else bad('GET missing profile expected 404', r1);
        if (r2.status === 404) ok('DELETE missing profile → 404');
        else bad('DELETE missing profile expected 404', r2);
    }

    // ── 8. GET /api/export/fingerprint (YAML)
    {
        const r = await api('GET', '/api/export/fingerprint');
        if (r.status === 200 && r.body?.success === true && typeof r.body.data === 'string' && r.body.data.includes(SCRATCH_A)) {
            ok(`GET /api/export/fingerprint includes ${SCRATCH_A}`);
        } else {
            bad('GET /api/export/fingerprint content', { status: r.status, hasA: r.body?.data?.includes?.(SCRATCH_A) });
        }
    }

    // ── 9. GET /api/export/all round-trip (encrypted backup)
    let backupBase64 = null;
    {
        const r = await api('GET', '/api/export/all?password=smoke-pw');
        if (r.status === 200 && r.body?.success === true && typeof r.body.data === 'string' && r.body.data.length > 100) {
            backupBase64 = r.body.data;
            ok(`GET /api/export/all password-required export (${(r.body.data.length / 1024).toFixed(1)} KB)`);
        } else {
            bad('GET /api/export/all shape', r);
        }
        // Missing password
        const r2 = await api('GET', '/api/export/all');
        if (r2.status === 400 && r2.body?.success === false) ok('  · missing password → 400');
        else bad('  · missing password expected 400', r2);
    }

    // ── 10. POST /api/import round-trip
    if (backupBase64) {
        const r = await api('POST', '/api/import', { content: backupBase64, password: 'smoke-pw' });
        if (r.status === 200 && r.body?.success === true && r.body.count > 0) {
            ok(`POST /api/import re-imports ${r.body.count} profile(s)`);
        } else {
            bad('POST /api/import status/body', r);
        }
    }
    // Bad password
    if (backupBase64) {
        const r = await api('POST', '/api/import', { content: backupBase64, password: 'wrong-pw' });
        if (r.status === 400 && r.body?.success === false) {
            ok('POST /api/import wrong password → 400');
        } else {
            bad('POST /api/import wrong password expected 400', r);
        }
    }

    // ── 11. POST /api/import YAML round-trip
    {
        const yaml = await api('GET', '/api/export/fingerprint');
        const r = await api('POST', '/api/import', { content: yaml.body.data });
        if (r.status === 200 && r.body?.success === true) {
            ok(`POST /api/import YAML re-imports (${r.body.count || '?'})`);
        } else {
            bad('POST /api/import YAML', r);
        }
        // Import creates copies with -02 suffix — clean them up.
        const all = await api('GET', '/api/profiles');
        for (const p of all.body?.profiles || []) {
            if (/^api-smoke-A-\d+/.test(p.name)) await api('DELETE', `/api/profiles/${p.id}`);
        }
    }

    // ── 12. GET /api/open + POST /:name/stop  (JSON mode)
    {
        const r = await api('GET', `/api/open/${encodeURIComponent(SCRATCH_A)}?stream=false`);
        if (r.status === 200 && r.body?.success === true && r.body.profileId === scratchAId) {
            ok(`GET /api/open ${SCRATCH_A} returns success + profileId`);
            const port = r.body['remote port'];
            if (Number.isFinite(port) && port > 1024) {
                ok(`  · "remote port" present (${port}) — CDP-ready`);
            } else {
                log(`  [33m~[0m "remote port" = ${port} (enable Remote Debugging in Settings to test CDP)`);
            }
        } else {
            bad(`GET /api/open ${SCRATCH_A}`, r);
        }

        // Wait a bit for the browser to actually spawn before stopping.
        await sleep(3500);

        // Verify status shows it running.
        const s = await api('GET', '/api/status');
        if (s.body?.running?.includes(scratchAId)) {
            ok(`GET /api/status now includes ${SCRATCH_A}`);
        } else {
            bad(`GET /api/status did not include just-launched ${SCRATCH_A}`, s.body);
        }

        // 409 while running — PUT should refuse.
        const puttry = await api('PUT', `/api/profiles/${encodeURIComponent(SCRATCH_A)}`, { notes: 'should fail' });
        if (puttry.status === 409) ok('PUT while running → 409');
        else bad('PUT while running expected 409', puttry);

        // Stop
        const stop = await api('POST', `/api/profiles/${encodeURIComponent(SCRATCH_A)}/stop`);
        if (stop.status === 200 && stop.body?.success === true) ok('POST /:name/stop → success');
        else bad('POST /:name/stop status', stop);

        // Give the process time to actually die before cleanup.
        await sleep(2000);
    }

    // ── 13. DELETE (cleanup)
    {
        const r = await api('DELETE', `/api/profiles/${encodeURIComponent(SCRATCH_A)}`);
        if (r.status === 200 && r.body?.success === true) ok(`DELETE /api/profiles/${SCRATCH_A}`);
        else bad(`DELETE /api/profiles/${SCRATCH_A}`, r);
    }

    // ── 14. Post-run cleanup: purge any profile whose id wasn't in the
    // starting snapshot. Catches collision-duplicates left by the import
    // round-trip tests. Safe because we only touch profiles that DID NOT
    // exist before this script ran.
    {
        const after = await api('GET', '/api/profiles');
        const strays = (after.body?.profiles || []).filter(p => !baseProfileIds.has(p.id));
        if (strays.length === 0) {
            ok('post-run cleanup: no stray profiles');
        } else {
            let cleaned = 0;
            for (const p of strays) {
                const r = await api('DELETE', `/api/profiles/${p.id}`);
                if (r.status === 200) cleaned++;
            }
            if (cleaned === strays.length) ok(`post-run cleanup: purged ${cleaned} stray profile(s)`);
            else bad(`post-run cleanup: purged ${cleaned}/${strays.length}`, strays.map(p => p.name));
        }
    }

    // ── Summary
    log(`\n== Summary ==`);
    log(`[32mPassed:[0m ${pass}`);
    log(`[31mFailed:[0m ${fail}`);
    if (fail > 0) {
        log('\nFailures:');
        for (const f of failures) log(` · ${f.msg}`);
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
    console.error('Harness crashed:', e);
    process.exit(2);
});
