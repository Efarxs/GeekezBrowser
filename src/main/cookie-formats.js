// Cookie import/export across three formats commonly used by e-commerce
// operators when handing off accounts between anti-detect browsers /
// automation stacks:
//
//   1. Netscape (Mozilla / cURL / wget cookies.txt) — de-facto text format
//   2. JSON (Playwright / Puppeteer format) — array of cookie objects
//   3. EditThisCookie v3 — Chrome extension export (JSON, slight schema
//      differences from Playwright)
//
// Internal canonical shape is CDP's Network.Cookie (matches Chrome DevTools
// Protocol): { name, value, domain, path, expires, httpOnly, secure,
// sameSite, session }. `sameSite` values: "Strict" | "Lax" | "None".

function detectFormat(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.startsWith('[') || s.startsWith('{')) {
        // JSON — could be Playwright or EditThisCookie v3
        try {
            const parsed = JSON.parse(s);
            const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : null);
            if (!arr || arr.length === 0) return 'json';
            const sample = arr[0];
            // EditThisCookie uses `hostOnly`, `storeId`, `id`; Playwright uses `sameSite` capitalized differently
            if (Object.prototype.hasOwnProperty.call(sample, 'hostOnly') ||
                Object.prototype.hasOwnProperty.call(sample, 'storeId') ||
                Object.prototype.hasOwnProperty.call(sample, 'id')) {
                return 'editthiscookie';
            }
            return 'json';
        } catch (e) {
            return null;
        }
    }
    if (s.startsWith('# Netscape') || /^[^\t]+\t(TRUE|FALSE)\t/m.test(s)) {
        return 'netscape';
    }
    return null;
}

function parseNetscape(raw) {
    const cookies = [];
    for (const line of String(raw).split(/\r?\n/)) {
        const trimmed = line.trim();
        // Comments start with `#`, but `#HttpOnly_` is a documented
        // marker that must be parsed as a real cookie line — not skipped.
        if (!trimmed) continue;
        if (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_')) continue;
        // Netscape spec: domain, includeSubdomains(TRUE/FALSE), path,
        // secure(TRUE/FALSE), expiry, name, value  (tab-delimited)
        const parts = trimmed.split('\t');
        if (parts.length < 7) continue;
        const [domain, includeSub, cookiePath, secureRaw, expiryRaw, name, ...valueParts] = parts;
        const value = valueParts.join('\t');
        cookies.push({
            name,
            value,
            domain: domain.startsWith('#HttpOnly_') ? domain.replace(/^#HttpOnly_/, '') : domain,
            path: cookiePath,
            expires: Number(expiryRaw) || -1,
            httpOnly: domain.startsWith('#HttpOnly_'),
            secure: /^TRUE$/i.test(secureRaw),
            sameSite: 'Lax',
            session: !expiryRaw || expiryRaw === '0'
        });
    }
    return cookies;
}

function toNetscape(cookies) {
    const lines = ['# Netscape HTTP Cookie File', '# Exported by GeekEZ Browser', ''];
    for (const c of cookies) {
        const domain = c.httpOnly ? `#HttpOnly_${c.domain}` : c.domain;
        const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = c.session || !c.expires || c.expires < 0
            ? '0'
            : String(Math.floor(c.expires));
        lines.push([domain, includeSub, c.path || '/', secure, expiry, c.name, c.value].join('\t'));
    }
    return lines.join('\n');
}

function parsePlaywrightJson(raw) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : []);
    return arr.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '',
        path: c.path || '/',
        expires: typeof c.expires === 'number' ? c.expires : -1,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: normalizeSameSite(c.sameSite),
        session: !c.expires || c.expires < 0
    }));
}

function toPlaywrightJson(cookies) {
    return JSON.stringify(cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        expires: c.session ? -1 : (c.expires || -1),
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: normalizeSameSite(c.sameSite)
    })), null, 2);
}

function parseEditThisCookie(raw) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '',
        path: c.path || '/',
        expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : -1,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: normalizeSameSite(c.sameSite),
        session: !!c.session || (typeof c.expirationDate !== 'number')
    }));
}

function toEditThisCookie(cookies) {
    return JSON.stringify(cookies.map((c, idx) => ({
        domain: c.domain,
        expirationDate: c.session ? undefined : (c.expires && c.expires > 0 ? c.expires : undefined),
        hostOnly: !c.domain.startsWith('.'),
        httpOnly: !!c.httpOnly,
        name: c.name,
        path: c.path || '/',
        sameSite: (normalizeSameSite(c.sameSite) || 'lax').toLowerCase(),
        secure: !!c.secure,
        session: !!c.session,
        storeId: '0',
        value: c.value,
        id: idx + 1
    })), null, 2);
}

function normalizeSameSite(v) {
    const s = String(v || '').toLowerCase();
    if (s === 'strict') return 'Strict';
    if (s === 'none' || s === 'no_restriction') return 'None';
    return 'Lax';
}

function parseCookies(raw, formatHint = null) {
    const format = formatHint || detectFormat(raw);
    if (!format) throw new Error('Unable to detect cookie format');
    if (format === 'netscape') return parseNetscape(raw);
    if (format === 'json') return parsePlaywrightJson(raw);
    if (format === 'editthiscookie') return parseEditThisCookie(raw);
    throw new Error(`Unsupported cookie format: ${format}`);
}

function serializeCookies(cookies, format) {
    if (format === 'netscape') return toNetscape(cookies);
    if (format === 'json') return toPlaywrightJson(cookies);
    if (format === 'editthiscookie') return toEditThisCookie(cookies);
    throw new Error(`Unsupported cookie format: ${format}`);
}

// Convert canonical shape → CDP Network.setCookies params. CDP only accepts
// `url` OR (domain+path); we compute url when domain looks like a hostname.
function toCdpSetCookies(cookies) {
    return cookies.map(c => {
        const isHostOnly = !c.domain.startsWith('.');
        const hostname = c.domain.replace(/^\./, '');
        const url = `${c.secure ? 'https' : 'http'}://${hostname}${c.path || '/'}`;
        const cdp = {
            name: c.name,
            value: c.value,
            url,
            domain: isHostOnly ? undefined : c.domain,
            path: c.path || '/',
            secure: !!c.secure,
            httpOnly: !!c.httpOnly,
            sameSite: normalizeSameSite(c.sameSite)
        };
        if (!c.session && c.expires && c.expires > 0) {
            cdp.expires = c.expires;
        }
        return cdp;
    });
}

module.exports = {
    detectFormat,
    parseCookies,
    serializeCookies,
    toCdpSetCookies
};
