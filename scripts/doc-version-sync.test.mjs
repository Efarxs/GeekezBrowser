// Guard: the in-app doc (resources/doc/doc.html) mirrors the API contract
// (docs/api/API.md). They are two files by design — API.md is the dev-facing
// markdown contract, doc.html is the bilingual in-app rendered view — so this
// test fails if their version headers drift, forcing a same-commit update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const apiMd = fs.readFileSync(path.join(root, 'docs/api/API.md'), 'utf8');
const docHtml = fs.readFileSync(path.join(root, 'resources/doc/doc.html'), 'utf8');

function ver(re, text, label) {
    const m = text.match(re);
    assert.ok(m, `could not find version via ${label}`);
    return m[1];
}

test('doc.html API section version matches API.md', () => {
    const md = ver(/适用版本：\*\*v(\d+\.\d+\.\d+)\*\*/, apiMd, 'API.md header');
    const zh = ver(/适用版本 v(\d+\.\d+\.\d+)/, docHtml, 'doc.html zh header');
    const en = ver(/Applies to v(\d+\.\d+\.\d+)/, docHtml, 'doc.html en header');
    assert.equal(zh, md, `doc.html(zh) v${zh} != API.md v${md} — update both when the API changes`);
    assert.equal(en, md, `doc.html(en) v${en} != API.md v${md} — update both when the API changes`);
});

test('doc.html and API.md cover the same endpoints', () => {
    // Spot-check the endpoints that were historically missed by the stale
    // hosted doc; if API.md documents them, the in-app doc must too.
    const endpoints = [
        '/api/profiles/:idOrName/duplicate',
        '/api/profiles/:idOrName/runtime',
        '/api/proxy/latency',
        '/api/kernels',
        '/api/settings',
    ];
    for (const e of endpoints) {
        assert.ok(apiMd.includes(e), `API.md missing ${e}`);
        assert.ok(docHtml.includes(e), `doc.html missing ${e} (drifted from API.md)`);
    }
    // Fields added in recent versions must appear in the in-app doc too.
    for (const f of ['preProxyStr', 'headless', 'disabledSpoofing', 'kernelVersion']) {
        assert.ok(docHtml.includes(f), `doc.html missing field ${f} (drifted from API.md)`);
    }
});
