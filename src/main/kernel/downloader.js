// Chunked HTTP downloader with Range-parallel + resume + cancel + progress.
//
// Progress events shape:
//   { phase: 'probe' | 'download' | 'verify', bytes, total,
//     speedBytesPerSec, etaSec, chunks: [{ index, bytes, total }] }
//
// Restart-resume:
//   Writes `<dest>.part` and `<dest>.meta.json`. `.meta.json` records url,
//   totalSize and per-chunk byte counts so an interrupted download can
//   pick up where it left off after an app restart.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { Transform } = require('stream');

const DEFAULT_CHUNK_COUNT = 4;
const MIN_CHUNK_SIZE = 4 * 1024 * 1024; // don't split below 4 MB
const HEAD_TIMEOUT_MS = 15000;
const CHUNK_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;

function pickClient(url) {
    return String(url).toLowerCase().startsWith('http:') ? http : https;
}

// HEAD (or Range-probing GET) to learn size + whether server honors Range.
// Follows redirects so `finalUrl` is the URL we should hit for real bytes.
function probeUrl(url, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (err, val) => { if (done) return; done = true; err ? reject(err) : resolve(val); };
        const client = pickClient(url);
        const req = client.request(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'GeekEZ-Kernel-Downloader/1.0' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirectsLeft <= 0) return finish(new Error('Too many redirects'));
                const next = new URL(res.headers.location, url).toString();
                probeUrl(next, redirectsLeft - 1).then((v) => finish(null, v), finish);
                res.resume();
                return;
            }
            if (res.statusCode >= 400) return finish(new Error(`HEAD ${res.statusCode}`));
            const total = parseInt(res.headers['content-length'], 10);
            const acceptRanges = String(res.headers['accept-ranges'] || '').toLowerCase().includes('bytes');
            res.resume();
            finish(null, {
                finalUrl: url,
                totalSize: Number.isFinite(total) ? total : 0,
                acceptRanges
            });
        });
        req.setTimeout(HEAD_TIMEOUT_MS, () => { req.destroy(new Error('HEAD timeout')); });
        req.on('error', finish);
        req.end();
    });
}

function planChunks(totalSize, chunkCount) {
    if (totalSize < MIN_CHUNK_SIZE * 2) return [{ start: 0, end: totalSize - 1 }];
    const n = Math.max(1, Math.min(chunkCount, Math.floor(totalSize / MIN_CHUNK_SIZE)));
    const size = Math.floor(totalSize / n);
    const chunks = [];
    for (let i = 0; i < n; i++) {
        const start = i * size;
        const end = i === n - 1 ? totalSize - 1 : start + size - 1;
        chunks.push({ start, end });
    }
    return chunks;
}

function fmtBytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

async function readMeta(metaPath) {
    try {
        const raw = await fsp.readFile(metaPath, 'utf8');
        return JSON.parse(raw);
    } catch { return null; }
}

async function writeMeta(metaPath, meta) {
    await fsp.writeFile(metaPath, JSON.stringify(meta), 'utf8');
}

// Download a single byte range into its own dedicated chunk file. Each chunk
// is a separate file with only that chunk's bytes; they are concatenated at
// the end. This is more portable than parallel writes to the same file
// (which has flaky semantics on Windows w.r.t. sparse extension).
function downloadRange(url, chunkPath, rangeStart, rangeEnd, alreadyDownloaded, signal, onChunkBytes) {
    return new Promise((resolve, reject) => {
        let done = false;
        let writeStream = null;
        const finish = (err) => {
            if (done) return;
            done = true;
            if (writeStream) { try { writeStream.destroy(); } catch (_) { } }
            err ? reject(err) : resolve();
        };

        if (signal && signal.aborted) return finish(new Error('aborted'));

        const actualStart = rangeStart + alreadyDownloaded;
        if (actualStart > rangeEnd) return finish(null); // already complete

        const client = pickClient(url);
        const req = client.request(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'GeekEZ-Kernel-Downloader/1.0',
                'Range': `bytes=${actualStart}-${rangeEnd}`,
                'Connection': 'keep-alive'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = new URL(res.headers.location, url).toString();
                res.resume();
                downloadRange(next, chunkPath, rangeStart, rangeEnd, alreadyDownloaded, signal, onChunkBytes)
                    .then(finish, finish);
                return;
            }
            // 206 for partial content, 200 acceptable if server ignored Range but we asked from 0
            const okStatus = res.statusCode === 206 || (res.statusCode === 200 && actualStart === rangeStart);
            if (!okStatus) return finish(new Error(`Range GET ${res.statusCode}`));

            const abortHandler = () => {
                res.destroy(new Error('aborted'));
                req.destroy(new Error('aborted'));
            };
            if (signal) signal.addEventListener?.('abort', abortHandler, { once: true });

            // Fresh append when resuming: 'a' opens for appending at end of
            // file. On a new chunk file this is equivalent to write-from-0.
            writeStream = fs.createWriteStream(chunkPath, { flags: 'a', autoClose: true });
            writeStream.on('error', finish);
            res.on('error', finish);

            const counter = new Transform({
                transform(chunk, _enc, cb) {
                    onChunkBytes(chunk.length);
                    cb(null, chunk);
                }
            });
            counter.on('error', finish);

            res.pipe(counter).pipe(writeStream);
            writeStream.on('finish', () => finish(null));
        });
        req.setTimeout(CHUNK_TIMEOUT_MS, () => { req.destroy(new Error('Chunk timeout')); });
        req.on('error', finish);
        req.end();
    });
}

// Concatenate all chunk files into a single output stream in order. Removes
// chunk files as it consumes them so a partial concat can be re-run.
async function concatChunks(chunkPaths, destPath, onProgress) {
    const out = fs.createWriteStream(destPath, { flags: 'w' });
    try {
        for (const cp of chunkPaths) {
            await new Promise((resolve, reject) => {
                const src = fs.createReadStream(cp);
                src.on('error', reject);
                src.on('end', resolve);
                src.pipe(out, { end: false });
            });
            onProgress?.({ phase: 'assemble', message: `merged ${path.basename(cp)}` });
        }
        await new Promise((resolve, reject) => {
            out.on('finish', resolve);
            out.on('error', reject);
            out.end();
        });
    } catch (e) {
        try { out.destroy(); } catch (_) { }
        throw e;
    }
    // Only remove chunk files after the concat file lands successfully.
    for (const cp of chunkPaths) {
        try { await fsp.unlink(cp); } catch (_) { }
    }
}

// Main entry: download `url` to `destPath`. Emits progress via `onProgress`.
// `signal` is an AbortSignal.
async function downloadChunked(url, destPath, {
    chunkCount = DEFAULT_CHUNK_COUNT,
    onProgress = () => { },
    signal = null,
    urlRewriter = null // (url) => rewrittenUrl — for gh-proxy fallback
} = {}) {
    const partPath = destPath + '.part';
    const metaPath = destPath + '.meta.json';
    const chunkPathFor = (i) => `${destPath}.chunk-${i}`;
    await fsp.mkdir(path.dirname(destPath), { recursive: true });

    const primaryUrl = url;
    const fallbackUrl = urlRewriter ? urlRewriter(url) : null;

    // Probe (with fallback swap on network error).
    let probed;
    try {
        probed = await probeUrl(primaryUrl);
    } catch (e) {
        if (fallbackUrl && fallbackUrl !== primaryUrl) {
            onProgress({ phase: 'probe', message: 'primary failed, switching mirror' });
            probed = await probeUrl(fallbackUrl);
        } else {
            throw e;
        }
    }
    const effectiveUrl = probed.finalUrl || primaryUrl;
    const totalSize = probed.totalSize;

    // Try to restore previous state (must match URL family + total).
    // Ground truth is the on-disk chunk file size — meta.downloaded is only
    // a hint. If a chunk file was truncated or lost, we redownload it.
    let meta = await readMeta(metaPath);
    const metaMatches = meta && meta.totalSize === totalSize && Array.isArray(meta.chunks);
    let chunks;
    if (metaMatches && probed.acceptRanges) {
        chunks = await Promise.all(meta.chunks.map(async (c, i) => {
            let onDisk = 0;
            try { onDisk = (await fsp.stat(chunkPathFor(i))).size; } catch (_) { }
            const expected = c.end - c.start + 1;
            const downloaded = Math.min(onDisk, expected);
            return { start: c.start, end: c.end, downloaded, index: i };
        }));
    } else {
        // Fresh plan; discard stale chunk files + partPath.
        try { await fsp.unlink(partPath); } catch (_) { }
        const planned = probed.acceptRanges && totalSize > 0
            ? planChunks(totalSize, chunkCount)
            : [{ start: 0, end: Math.max(0, totalSize - 1) }];
        chunks = planned.map((c, i) => ({ ...c, downloaded: 0, index: i }));
        // Clear any stale chunk files at these indices.
        for (let i = 0; i < chunks.length; i++) {
            try { await fsp.unlink(chunkPathFor(i)); } catch (_) { }
        }
        meta = { url: primaryUrl, totalSize, chunks: chunks.map(({ start, end, downloaded }) => ({ start, end, downloaded })) };
        await writeMeta(metaPath, meta);
    }

    // If chunk on-disk sizes indicate the download already finished but
    // assembly didn't run (crash between last chunk finish and rename),
    // pick up at the assemble step.

    const startTime = Date.now();
    let lastEmitTime = 0;
    const emitInterval = 250; // ms

    const emit = () => {
        const bytes = chunks.reduce((s, c) => s + c.downloaded, 0);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? bytes / elapsed : 0;
        const eta = speed > 0 && totalSize > 0 ? (totalSize - bytes) / speed : 0;
        onProgress({
            phase: 'download',
            bytes,
            total: totalSize,
            speedBytesPerSec: speed,
            etaSec: eta,
            chunks: chunks.map(c => ({ index: c.index, bytes: c.downloaded, total: c.end - c.start + 1 }))
        });
    };

    const persistMeta = () => {
        meta.chunks = chunks.map(({ start, end, downloaded }) => ({ start, end, downloaded }));
        writeMeta(metaPath, meta).catch(() => { });
    };

    let lastPersistTime = 0;

    const onChunkBytesFactory = (chunk) => (delta) => {
        chunk.downloaded += delta;
        const now = Date.now();
        if (now - lastEmitTime > emitInterval) {
            lastEmitTime = now;
            emit();
        }
        if (now - lastPersistTime > 2000) {
            lastPersistTime = now;
            persistMeta();
        }
    };

    try {
        emit();
        const tasks = chunks.map((c) => downloadRange(
            effectiveUrl, chunkPathFor(c.index), c.start, c.end, c.downloaded, signal, onChunkBytesFactory(c)
        ));
        await Promise.all(tasks);
        persistMeta();
        emit();
    } catch (e) {
        persistMeta();
        if (fallbackUrl && effectiveUrl === probed.finalUrl && fallbackUrl !== primaryUrl && !(signal && signal.aborted)) {
            onProgress({ phase: 'download', message: `retry via mirror: ${e.message}` });
            return downloadChunked(fallbackUrl, destPath, { chunkCount, onProgress, signal, urlRewriter: null });
        }
        throw e;
    }

    // Concat chunk files → partPath → rename → destPath.
    onProgress({ phase: 'assemble', message: 'assembling chunks' });
    await concatChunks(chunks.map(c => chunkPathFor(c.index)), partPath, onProgress);
    try { await fsp.unlink(destPath); } catch (_) { }
    await fsp.rename(partPath, destPath);
    try { await fsp.unlink(metaPath); } catch (_) { }

    return { path: destPath, bytes: totalSize };
}

module.exports = { downloadChunked, fmtBytes };
