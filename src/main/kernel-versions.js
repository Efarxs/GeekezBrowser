// Chrome major/full version pool + Sec-CH-UA brand construction.
// Extracted from fingerprint.js purely so these pure functions can be
// require()d from a plain-Node test runner (fingerprint.js is a Vite
// hybrid module that mixes CommonJS require with ESM export and can't
// be loaded by raw Node). No behavioral change — fingerprint.js
// re-exports from here.

const crypto = require('crypto');

// Ordered newest-first because generateFingerprint biases toward the
// latest (weight index 0 heaviest).
const BROWSER_MAJOR_VERSIONS = [148, 144, 142, 139, 138];

// Real Google Chrome stable patch numbers per major. Keeping the pool
// tied to *shipped* Chrome releases matters: browserscan-style
// detectors compare the declared Sec-CH-UA-Full-Version-List value
// against a known-good list, so invented patches (or the ungoogled-
// chromium build's own patch id) score as spoofed. Only include majors
// we can actually ship a kernel for.
const BROWSER_FULL_VERSION_POOL = [
    // Chrome 148 stable patches
    '148.0.7778.56',
    '148.0.7778.96',
    '148.0.7778.97',
    '148.0.7778.98',
    '148.0.7778.167',
    '148.0.7778.168',
    '148.0.7778.169',
    '148.0.7778.178',
    '148.0.7778.179',
    '148.0.7778.180',
    '148.0.7778.181',
    '148.0.7778.216',
    '148.0.7778.217',
    '148.0.7778.218',
    // Chrome 144 stable patches
    '144.0.7559.132',
    '144.0.7559.121',
    '144.0.7559.104',
    '144.0.7559.90',
    '144.0.7559.65',
    // Chrome 142 stable patches
    '142.0.7444.175',
    '142.0.7444.162',
    '142.0.7444.147',
    '142.0.7444.135',
    '142.0.7444.113',
    // Chrome 139 stable patches
    '139.0.7258.154',
    '139.0.7258.139',
    '139.0.7258.128',
    '139.0.7258.94',
    '139.0.7258.67',
    // Chrome 138 stable patches
    '138.0.7204.183',
    '138.0.7204.169',
    '138.0.7204.157',
    '138.0.7204.101',
    '138.0.7204.98'
];
const BROWSER_FULL_VERSION_BY_MAJOR = BROWSER_FULL_VERSION_POOL.reduce((acc, version) => {
    const major = String(version).split('.')[0];
    if (!acc[major]) acc[major] = [];
    if (!acc[major].includes(version)) acc[major].push(version);
    return acc;
}, {});

// Pick a random Chrome stable patch for the given major, from the pool.
// Returns null when we don't have any patches for that major on file
// (caller can fall back to a synthetic `${major}.0.0.0`).
function pickFullVersionForMajor(major) {
    const m = String(major);
    const pool = BROWSER_FULL_VERSION_BY_MAJOR[m];
    if (Array.isArray(pool) && pool.length > 0) {
        return pool[crypto.randomInt(0, pool.length)];
    }
    return null;
}

// Sec-CH-UA + Sec-CH-UA-Full-Version-List construction. Order matters
// (Chrome always ships Not.A/Brand first, then Chromium, then the
// browser brand); brand names must match a real Chrome release verbatim
// or browserscan flags the profile as spoofed.
function buildBrowserBrands(browserType, majorVersion, fullVersion) {
    const browserBrand = browserType === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
    const brands = [
        { brand: 'Not.A/Brand', version: '99' },
        { brand: 'Chromium', version: String(majorVersion) },
        { brand: browserBrand, version: String(majorVersion) }
    ];

    return {
        brands,
        fullVersionList: [
            { brand: 'Not.A/Brand', version: '99.0.0.0' },
            { brand: 'Chromium', version: fullVersion },
            { brand: browserBrand, version: fullVersion }
        ]
    };
}

module.exports = {
    BROWSER_MAJOR_VERSIONS,
    BROWSER_FULL_VERSION_POOL,
    BROWSER_FULL_VERSION_BY_MAJOR,
    pickFullVersionForMajor,
    buildBrowserBrands
};
