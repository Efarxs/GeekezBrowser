// Unit tests for src/main/kernel-versions.js.
// Runs with `node --test scripts/kernel-versions.test.mjs` — no external
// runner required. The functions here are the two flagged in the
// project audit as high-leverage: pickFullVersionForMajor (a corrupt
// patch string in the pool would break Sec-CH-UA-Full-Version-List
// validation on browserscan) and buildBrowserBrands (edge/chrome
// branding + fixed Not.A/Brand position is what parsers key on).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
    BROWSER_MAJOR_VERSIONS,
    BROWSER_FULL_VERSION_POOL,
    BROWSER_FULL_VERSION_BY_MAJOR,
    pickFullVersionForMajor,
    buildBrowserBrands
} = require('../src/main/kernel-versions.js');

// ── BROWSER_FULL_VERSION_POOL integrity ──────────────────────────────

test('pool: every entry is a valid 4-part Chrome patch string', () => {
    const rx = /^\d+\.\d+\.\d+\.\d+$/;
    for (const v of BROWSER_FULL_VERSION_POOL) {
        assert.match(v, rx, `bad patch "${v}"`);
    }
});

test('pool: no duplicates', () => {
    const set = new Set(BROWSER_FULL_VERSION_POOL);
    assert.equal(set.size, BROWSER_FULL_VERSION_POOL.length, 'duplicate patch(es) in pool');
});

test('pool: every listed major has at least one patch', () => {
    for (const major of BROWSER_MAJOR_VERSIONS) {
        const patches = BROWSER_FULL_VERSION_BY_MAJOR[String(major)];
        assert.ok(Array.isArray(patches) && patches.length > 0,
            `major ${major} is in BROWSER_MAJOR_VERSIONS but has no patches`);
    }
});

test('pool: every patch belongs to a major listed in BROWSER_MAJOR_VERSIONS', () => {
    const knownMajors = new Set(BROWSER_MAJOR_VERSIONS.map(String));
    for (const v of BROWSER_FULL_VERSION_POOL) {
        const m = v.split('.')[0];
        assert.ok(knownMajors.has(m), `patch ${v} belongs to major ${m} which isn't in BROWSER_MAJOR_VERSIONS`);
    }
});

// ── pickFullVersionForMajor ──────────────────────────────────────────

test('pickFullVersionForMajor(148) returns a Chrome 148 patch from the pool', () => {
    for (let i = 0; i < 30; i++) {
        const v = pickFullVersionForMajor(148);
        assert.ok(v, 'expected a string, got null/undefined');
        assert.equal(v.split('.')[0], '148', `expected 148.*, got ${v}`);
        assert.ok(BROWSER_FULL_VERSION_POOL.includes(v), `${v} not in pool`);
    }
});

test('pickFullVersionForMajor works for every listed major', () => {
    for (const major of BROWSER_MAJOR_VERSIONS) {
        const v = pickFullVersionForMajor(major);
        assert.ok(v, `major ${major} returned null despite being listed`);
        assert.equal(v.split('.')[0], String(major));
    }
});

test('pickFullVersionForMajor accepts string input identically to number', () => {
    const num = pickFullVersionForMajor(148);
    const str = pickFullVersionForMajor('148');
    assert.equal(num.split('.')[0], '148');
    assert.equal(str.split('.')[0], '148');
});

test('pickFullVersionForMajor returns null for unknown major', () => {
    assert.equal(pickFullVersionForMajor(999), null);
    assert.equal(pickFullVersionForMajor(0), null);
    assert.equal(pickFullVersionForMajor('bogus'), null);
});

test('pickFullVersionForMajor rotates across calls (not stuck on one)', () => {
    // Chrome 148 has 14 patches. With 100 samples we'd expect ~7 distinct
    // — asserting >=2 is a very loose sanity check that getRandom fires.
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(pickFullVersionForMajor(148));
    assert.ok(seen.size >= 2, `only ${seen.size} distinct value(s) in 100 samples — RNG stuck?`);
});

// ── buildBrowserBrands ───────────────────────────────────────────────

test('buildBrowserBrands: chrome shape', () => {
    const out = buildBrowserBrands('chrome', 148, '148.0.7778.216');
    assert.deepEqual(out.brands, [
        { brand: 'Not.A/Brand', version: '99' },
        { brand: 'Chromium', version: '148' },
        { brand: 'Google Chrome', version: '148' }
    ]);
    assert.deepEqual(out.fullVersionList, [
        { brand: 'Not.A/Brand', version: '99.0.0.0' },
        { brand: 'Chromium', version: '148.0.7778.216' },
        { brand: 'Google Chrome', version: '148.0.7778.216' }
    ]);
});

test('buildBrowserBrands: edge maps to "Microsoft Edge" brand', () => {
    const out = buildBrowserBrands('edge', 148, '148.0.7778.216');
    const edgeBrand = out.brands.find(b => b.brand !== 'Not.A/Brand' && b.brand !== 'Chromium');
    assert.equal(edgeBrand.brand, 'Microsoft Edge');
    // fullVersionList mirrors brands with the same swap.
    const edgeFvl = out.fullVersionList.find(b => b.brand !== 'Not.A/Brand' && b.brand !== 'Chromium');
    assert.equal(edgeFvl.brand, 'Microsoft Edge');
});

test('buildBrowserBrands: unknown browserType falls back to Chrome branding', () => {
    // Anything that isn't literally "edge" defaults to Google Chrome —
    // ensures a typo doesn't silently produce a garbage brand string
    // that browserscan will flag.
    for (const bogus of ['firefox', 'safari', '', undefined, null]) {
        const out = buildBrowserBrands(bogus, 148, '148.0.7778.216');
        const brand = out.brands.find(b => b.brand !== 'Not.A/Brand' && b.brand !== 'Chromium');
        assert.equal(brand.brand, 'Google Chrome', `browserType=${JSON.stringify(bogus)} should default to Chrome`);
    }
});

test('buildBrowserBrands: Not.A/Brand is always position 0 with v="99"', () => {
    // If a refactor reordered these, real Chrome sends Not.A/Brand
    // first and detectors would flag ours as spoofed.
    for (const [t, mv, fv] of [
        ['chrome', 148, '148.0.7778.216'],
        ['edge', 144, '144.0.7559.132'],
        ['chrome', 138, '138.0.7204.98']
    ]) {
        const out = buildBrowserBrands(t, mv, fv);
        assert.equal(out.brands[0].brand, 'Not.A/Brand');
        assert.equal(out.brands[0].version, '99');
        assert.equal(out.fullVersionList[0].brand, 'Not.A/Brand');
        assert.equal(out.fullVersionList[0].version, '99.0.0.0');
    }
});

test('buildBrowserBrands: brands.length === fullVersionList.length', () => {
    const out = buildBrowserBrands('chrome', 148, '148.0.7778.216');
    assert.equal(out.brands.length, out.fullVersionList.length);
    // Corresponding entries share brand names in the same order.
    for (let i = 0; i < out.brands.length; i++) {
        assert.equal(out.brands[i].brand, out.fullVersionList[i].brand);
    }
});

test('buildBrowserBrands: numeric majorVersion → string in output', () => {
    // Client Hints headers are strings, so downstream Sec-CH-UA
    // serialization needs strings. If we shipped a number here the
    // header value would be "148" quoted differently than real Chrome.
    const out = buildBrowserBrands('chrome', 148, '148.0.7778.216');
    for (const b of out.brands) {
        assert.equal(typeof b.version, 'string');
    }
});
