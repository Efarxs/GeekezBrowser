/**
 * Playwright CDP automation example: browse youtube.com in a GeekEZ Browser
 * profile.
 *
 * Three ways to point the script at a browser (checked in this order):
 *
 *   1) You already launched the profile from the UI (with Remote Debugging
 *      turned on in Settings) — pass the port directly:
 *
 *        node youtube-cdp.js --port=9222
 *
 *   2) You have an existing profile — let the API open it for you:
 *
 *        node youtube-cdp.js --profile=my-profile
 *
 *   3) Create the profile on the fly, then open + attach. Useful for
 *      throwaway automation runs against a fresh identity:
 *
 *        node youtube-cdp.js --profile=demo-yt --proxy=socks5://127.0.0.1:7890
 *
 *      If a profile named "demo-yt" doesn't exist yet, the script POSTs
 *      /api/profiles with the given proxy string to create it, then opens
 *      it.
 *
 * All CLI flags have GEEKEZ_* env-var equivalents (GEEKEZ_CDP_PORT,
 * GEEKEZ_PROFILE, GEEKEZ_PROXY, GEEKEZ_API_PORT).
 *
 * Prerequisites:
 *   - Settings → 🔧 Remote Debugging is ON (otherwise no CDP port is
 *     opened when the profile launches).
 *   - Settings → 🔌 API Server is ON if you use --profile / --proxy
 *     (defaults to 127.0.0.1:12138).
 *   - Profile is NOT launched with "使用干净 profile 启动" (that mode
 *     intentionally strips the debug port for maximum stealth).
 *   - Run `npm install` inside ./examples first.
 */

'use strict';

const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

// ------------------------------------------------------------
// Argument parsing
// ------------------------------------------------------------
function parseArgs(argv) {
    const out = {};
    for (const arg of argv.slice(2)) {
        const m = arg.match(/^--([^=]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

const args = parseArgs(process.argv);
const cdpPort = Number(args.port || process.env.GEEKEZ_CDP_PORT || 0);
const apiPort = Number(args['api-port'] || process.env.GEEKEZ_API_PORT || 12138);
const profileName = args.profile || process.env.GEEKEZ_PROFILE || '';
const proxyStr = args.proxy || process.env.GEEKEZ_PROXY || '';

// ------------------------------------------------------------
// Helpers — small hand-rolled HTTP client so this file has no deps
// beyond playwright-core.
// ------------------------------------------------------------
function apiRequest(port, method, apiPath, jsonBody) {
    return new Promise((resolve, reject) => {
        const payload = jsonBody ? Buffer.from(JSON.stringify(jsonBody), 'utf8') : null;
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: apiPath,
            method,
            timeout: 60000,
            headers: payload
                ? { 'content-type': 'application/json', 'content-length': payload.length }
                : {}
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                let parsed;
                try { parsed = body ? JSON.parse(body) : {}; }
                catch (e) { return reject(new Error(`Bad JSON from API: ${body.slice(0, 200)}`)); }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('API request timed out')));
        if (payload) req.write(payload);
        req.end();
    });
}

async function apiGetJson(port, apiPath) {
    const { status, body } = await apiRequest(port, 'GET', apiPath, null);
    if (status >= 400) {
        const err = new Error(`API ${status}: ${body?.error || JSON.stringify(body).slice(0, 200)}`);
        err.status = status;
        throw err;
    }
    return body;
}

async function findProfileByName(port, name) {
    try {
        return await apiGetJson(port, `/api/profiles/${encodeURIComponent(name)}`);
    } catch (err) {
        if (err.status === 404) return null;
        throw err;
    }
}

async function createProfile(port, name, proxy) {
    console.log(`▸ Creating profile "${name}" with proxy ${proxy} via POST /api/profiles`);
    const { status, body } = await apiRequest(port, 'POST', '/api/profiles', {
        name,
        proxyStr: proxy,
        tags: ['examples']
    });
    if (status >= 400 || !body?.success) {
        throw new Error(`Create profile failed: ${body?.error || `HTTP ${status}`}`);
    }
    // GeekEZ assigns a stable debug port to every profile at creation time.
    // The same port is reused every time the profile is launched — remember
    // it so we can skip polling later.
    const assignedPort = body.remoteDebugPort || null;
    console.log(`  created id=${body.profile?.id || '?'}, remote debug port = ${assignedPort || '(not assigned — Remote Debugging setting is off?)'}`);
    return { profile: body.profile, remoteDebugPort: assignedPort };
}

async function ensureProfile() {
    if (!proxyStr) return null;
    const existing = await findProfileByName(apiPort, profileName);
    if (existing) {
        console.log(`▸ Profile "${profileName}" already exists — reusing (proxy unchanged)`);
        // Existing profiles carry the port on the profile record.
        const existingPort = existing.profile?.debugPort || existing.debugPort || null;
        if (existingPort) console.log(`  known remote debug port = ${existingPort}`);
        return existingPort;
    }
    const created = await createProfile(apiPort, profileName, proxyStr);
    return created.remoteDebugPort;
}

async function resolveRemotePort() {
    if (cdpPort) {
        console.log(`▸ Using CDP port from CLI/env: ${cdpPort}`);
        return cdpPort;
    }
    if (!profileName) {
        throw new Error(
            'No CDP port supplied and no profile name to open via API.\n' +
            '  Pass one of:\n' +
            '    --port=<n>                                 (attach mode)\n' +
            '    --profile=<name>                           (open existing via API)\n' +
            '    --profile=<name> --proxy=socks5://host:port (create if missing, then open)\n'
        );
    }
    const preassignedPort = await ensureProfile();
    console.log(`▸ Asking GeekEZ API on 127.0.0.1:${apiPort} to open profile "${profileName}"`);
    const res = await apiGetJson(apiPort, `/api/open/${encodeURIComponent(profileName)}`);
    const port = Number(res['remote port'] || res.remotePort || preassignedPort || 0);
    if (!port) {
        throw new Error(
            `API launched the profile but returned no "remote port". Make sure Remote\n` +
            `Debugging is enabled in Settings and the profile was not launched with\n` +
            `"使用干净 profile 启动".`
        );
    }
    console.log(`▸ Profile launched (${res.message || 'ok'}), remote port = ${port}`);
    return port;
}

async function waitForCdp(port, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            const info = await apiGetJson(port, '/json/version');
            if (info && info.webSocketDebuggerUrl) return info;
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Chrome DevTools endpoint on port ${port} never responded: ${lastErr?.message || 'unknown'}`);
}

// ------------------------------------------------------------
// The scenario
// ------------------------------------------------------------
async function run(page) {
    console.log('▸ Navigating to https://www.youtube.com/');
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // YouTube often shows a consent interstitial the first time; accept if present.
    try {
        const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree"), button:has-text("同意")');
        if (await consent.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('▸ Consent dialog present — clicking accept');
            await consent.first().click();
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
        }
    } catch (e) { /* no consent shown, fine */ }

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });

    const initialTitle = await page.title();
    console.log(`  page title: ${initialTitle}`);

    const homeShot = path.join(__dirname, 'youtube-home.png');
    await page.screenshot({ path: homeShot, fullPage: false });
    console.log(`▸ Home screenshot: ${homeShot}`);

    // Search bar → type → submit
    console.log('▸ Searching "lofi hip hop radio"');
    const searchInput = page.locator('input[name="search_query"]');
    await searchInput.first().waitFor({ timeout: 20000 });
    await searchInput.first().click({ timeout: 5000 }).catch(() => { });
    await searchInput.first().fill('lofi hip hop radio');
    await page.keyboard.press('Enter');

    // Wait for results grid
    await page.waitForURL(/\/results\?/, { timeout: 20000 }).catch(() => { });
    await page.waitForSelector('ytd-video-renderer, ytd-search', { timeout: 20000 }).catch(() => { });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

    const resultCount = await page.locator('ytd-video-renderer').count();
    console.log(`  results loaded: ${resultCount} video cards`);

    const resultsShot = path.join(__dirname, 'youtube-results.png');
    await page.screenshot({ path: resultsShot, fullPage: false });
    console.log(`▸ Results screenshot: ${resultsShot}`);

    // Report some fingerprint hints so we can eyeball what YouTube saw.
    const identity = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        languages: navigator.languages,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        webdriver: navigator.webdriver,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio }
    }));
    console.log('▸ Runtime identity as seen by the page:');
    console.log(JSON.stringify(identity, null, 2));
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
(async () => {
    const port = await resolveRemotePort();
    console.log(`▸ Probing CDP endpoint at http://127.0.0.1:${port}/json/version`);
    await waitForCdp(port);

    console.log('▸ Connecting Playwright over CDP');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
        // The profile already has (at least) one default context.
        const contexts = browser.contexts();
        const context = contexts[0] || (await browser.newContext());
        const page = context.pages()[0] || (await context.newPage());
        // Bring the tab we're driving to the front so the user can watch.
        try { await page.bringToFront(); } catch (e) { }
        await run(page);
        console.log('✓ Done. Leaving the browser open (only disconnecting Playwright).');
    } finally {
        // Detach without closing the browser — we want the user's profile to stay alive.
        await browser.close();
    }
})().catch((err) => {
    console.error('✗ Example failed:', err.message || err);
    process.exit(1);
});
