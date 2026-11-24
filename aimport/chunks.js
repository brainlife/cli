'use strict';

// The chunk map of reference datasets (an OME-Zarr input that aimport does not copy).
//
// The engine writes only new metadata for such a store under bids/, plus
// <work>/output/bids.chunks.json, which says where each array's chunks are:
//   {"version": 1, "arrays": {"<array dir under bids/>": {
//       "source": {"input": "<input-relative dir>"} | {"url": "<https URL>"},
//       "zarr_format": 2|3, "shape": [...], "chunk_grid": [...], "separator": "/"|".",
//       "codec_bytes_hint": n, ["key_encoding": "v2"]}}}
// The upload streams each chunk from its source into the object's tar; nothing is
// copied to disk. These rules mirror the engine's aimport/micr/reference.py (chunk keys,
// resolve) and aimport/micr/remote.py (URL and redirect rules). The map holds input
// paths and URLs: it is never uploaded and its content is never printed.

const fs = require('fs');
const net = require('net');
const path = require('path');
const {Readable} = require('stream');

const CHUNK_MAP_VERSION = 1;
const SEPARATORS = ['/', '.'];
const INDEX = /^(0|[1-9][0-9]*)$/;
const MAX_REDIRECTS = 5;
const MISSING_STATUS = new Set([403, 404, 410]); // S3 answers 403 for a missing key when listing is not allowed

class ChunkMapError extends Error {}

function decoded(seg) {
    try {
        return decodeURIComponent(seg);
    } catch (err) {
        return seg;
    }
}

// the segments of a plain relative posix path: no absolute path, no '', '.' or '..' (also %2e%2e)
function segments(p) {
    if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') || p.includes('\0')) {
        throw new ChunkMapError('not a relative path');
    }
    const parts = p.split('/');
    if (parts.some(s => s === '' || s === '.' || s === '..' || decoded(s) === '.' || decoded(s) === '..')) {
        throw new ChunkMapError('not a plain relative path');
    }
    return parts;
}

// --- chunk keys (reference.chunk_keys / key_ok) ---------------------------------------------

function counts(meta) {
    const shape = meta && meta.shape, grid = meta && meta.chunk_grid;
    if (!Array.isArray(shape) || !Array.isArray(grid) || shape.length !== grid.length ||
        shape.some(s => !Number.isInteger(s) || s < 0) || grid.some(g => !Number.isInteger(g) || g <= 0)) {
        throw new ChunkMapError('the chunk map entry has no valid chunk grid');
    }
    return shape.map((s, i) => Math.ceil(s / grid[i]));
}

function prefixed(meta) {
    return meta.zarr_format === 3 && (meta.key_encoding === undefined || meta.key_encoding === 'default');
}

function separator(meta) {
    if (!SEPARATORS.includes(meta.separator)) throw new ChunkMapError('the chunk map entry has no valid separator');
    return meta.separator;
}

// every chunk (or shard) key of an array, from its shape and grid: Zarr v2 0.0.0 or 0/0/0,
// Zarr v3 c/0/0/0 (or c.0.0.0). A key with no source object is the fill value.
function* chunkKeys(meta) {
    const sep = separator(meta), pre = prefixed(meta), n = counts(meta);
    if (n.some(c => c === 0)) return;
    const idx = n.map(() => 0);
    for (;;) {
        const body = idx.join(sep);
        if (pre) yield 'c' + (idx.length ? sep + body : '');
        else yield idx.length ? body : '0';
        let d = idx.length - 1;
        while (d >= 0 && ++idx[d] >= n[d]) idx[d--] = 0;
        if (d < 0) return;
    }
}

function keyCount(meta) {
    return counts(meta).reduce((a, b) => a * b, 1);
}

// whether key is one of chunkKeys(meta): digits and separators only, inside the grid
function keyOk(meta, key) {
    const sep = separator(meta), n = counts(meta);
    if (typeof key !== 'string') return false;
    if (prefixed(meta)) {
        if (!key.startsWith('c')) return false;
        key = key.slice(1);
        if (!n.length) return key === '';
        if (!key.startsWith(sep)) return false;
        key = key.slice(1);
    } else if (!n.length) {
        return key === '0';
    }
    const parts = key.split(sep);
    return parts.length === n.length && parts.every((p, i) => INDEX.test(p) && Number(p) < n[i]);
}

// --- remote rules (remote.normalize_url / redirect_allowed) ---------------------------------

// IP literals, localhost (and *.localhost) and single-label hosts
function hostRefused(host) {
    if (!host || !host.includes('.')) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (net.isIP(host.replace(/^\[|\]$/g, ''))) return true;
    const last = host.slice(host.lastIndexOf('.') + 1);
    return !/[a-z]/.test(last) || last.startsWith('0x');
}

// the canonical https URL of a remote source; throws otherwise (s3:// is turned into https by
// the engine before it writes the map, so only https:// is accepted here)
function normalizeUrl(url) {
    if (typeof url !== 'string' || /\s/.test(url)) throw new ChunkMapError('a remote source is not a URL');
    let u;
    try {
        u = new URL(url);
    } catch (err) {
        throw new ChunkMapError('a remote source is not a URL');
    }
    if (u.protocol !== 'https:') throw new ChunkMapError('remote sources must be https:// URLs');
    const authority = url.slice(url.indexOf('//') + 2).split(/[/?#]/)[0];
    if (u.username || u.password || authority.includes('@')) throw new ChunkMapError('remote URLs must not carry user information');
    if (u.search || u.hash || url.includes('?') || url.includes('#')) {
        throw new ChunkMapError('remote URLs must not carry a query or fragment');
    }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (hostRefused(host)) throw new ChunkMapError('remote host must be a dotted DNS name (not an IP address or localhost)');
    // the raw path: the URL parser would already have removed '..' (also %2e%2e)
    const rawPath = url.slice(url.indexOf('//') + 2 + authority.length);
    if (rawPath.split('/').some(s => decoded(s) === '.' || decoded(s) === '..')) {
        throw new ChunkMapError('a remote URL has a relative or encoded path segment');
    }
    const netloc = u.port && u.port !== '443' ? host + ':' + u.port : host;
    return 'https://' + netloc + u.pathname.replace(/\/+$/, '');
}

// same origin as the request, or an https *.amazonaws.com host
function redirectAllowed(originUrl, location) {
    let target, origin;
    try {
        origin = new URL(originUrl);
        target = new URL(location, originUrl);
    } catch (err) {
        return false;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(location) && !location.startsWith('//')) return true; // relative: same origin
    if (target.protocol === origin.protocol && target.host.toLowerCase() === origin.host.toLowerCase()) return true;
    const host = target.hostname.toLowerCase();
    return target.protocol === 'https:' && !target.username && !target.password &&
        (target.port === '' || target.port === '443') && host.endsWith('.amazonaws.com');
}

// --- loading and checking -------------------------------------------------------------------

function inside(root, p) {
    return p !== root && p.startsWith(root + path.sep);
}

// The chunk map /status names (rel, relative to work), or null when it names none.
// Returns {bidsDir, inputDir, arrays}; throws when the named map is missing or not a chunk map.
function loadChunkMap(work, bidsDir, inputDir, manifest, rel) {
    if (rel === undefined || rel === null || rel === '') return null;
    const workDir = path.resolve(work);
    const file = path.join(workDir, ...segments(rel));
    if (!file.endsWith('.chunks.json')) throw new ChunkMapError('the chunk map is not a .chunks.json file');
    if (inside(path.resolve(bidsDir), file)) throw new ChunkMapError('the chunk map lies inside the output');
    let data;
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new ChunkMapError('the chunk map cannot be read; execute the plan again');
    }
    if (!data || typeof data !== 'object' || data.version !== CHUNK_MAP_VERSION ||
        !data.arrays || typeof data.arrays !== 'object' || Array.isArray(data.arrays)) {
        throw new ChunkMapError('the chunk map has an unknown format; update bl or rebuild the engine image');
    }
    void manifest; // checked against the chunk map by preflight
    return {bidsDir: path.resolve(bidsDir), inputDir: path.resolve(inputDir), arrays: data.arrays};
}

// the manifest's .ome.zarr directories (relative to the output)
function zarrDirs(manifest) {
    const out = [];
    for (const rels of Object.values(manifest || {})) {
        for (const r of Array.isArray(rels) ? rels : []) if (typeof r === 'string' && r.endsWith('.ome.zarr')) out.push(r);
    }
    return out;
}

// walk an input-relative path below root: no segment may be a symlink. Returns the full path.
function walkInput(root, segs) {
    let p = root;
    for (const s of segs) {
        p = path.join(p, s);
        let st;
        try {
            st = fs.lstatSync(p);
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return {path: p, missing: true};
            throw err;
        }
        if (st.isSymbolicLink()) throw new ChunkMapError('a referenced source goes through a symlink');
    }
    return {path: p, missing: false};
}

// every array of the map: strictly inside a manifest .ome.zarr directory that was written, with a
// valid grid and one source that stays inside the input folder or is an allowed https URL
function checkChunkMap(outputDir, chunkMap, manifest, inputDir) {
    const root = path.resolve(outputDir);
    const dirs = zarrDirs(manifest);
    let inputReal = null;
    for (const [prefix, meta] of Object.entries(chunkMap.arrays)) {
        let segs;
        try {
            segs = segments(prefix);
        } catch (err) {
            throw new Error('refusing to upload: the chunk map names an array outside the output');
        }
        const norm = segs.join('/');
        if (!dirs.some(d => norm.startsWith(d + '/'))) {
            throw new Error('refusing to upload: the chunk map names an array outside the written OME-Zarr images');
        }
        let st = null;
        try {
            st = fs.lstatSync(path.join(root, ...segs));
        } catch (err) {
            // missing
        }
        if (!st || !st.isDirectory()) throw new Error('refusing to upload: a referenced array has no metadata in the output');
        if (!meta || typeof meta !== 'object' || ![2, 3].includes(meta.zarr_format)) {
            throw new Error('refusing to upload: a chunk map entry has no valid Zarr format');
        }
        try {
            separator(meta);
            counts(meta);
        } catch (err) {
            throw new Error('refusing to upload: ' + err.message);
        }
        const source = meta.source;
        if (!source || typeof source !== 'object' || Object.keys(source).length !== 1) {
            throw new Error('refusing to upload: a chunk map entry has no valid source');
        }
        if ('input' in source) {
            if (!inputDir) throw new Error('refusing to upload: a referenced source needs the input folder');
            if (!inputReal) inputReal = fs.realpathSync(path.resolve(inputDir));
            let walked;
            try {
                walked = walkInput(inputReal, segments(source.input));
            } catch (err) {
                throw new Error('refusing to upload: a referenced source leaves the input folder (' + err.message + ')');
            }
            if (walked.missing) throw new Error('refusing to upload: a referenced source folder is missing from the input');
            if (!inside(inputReal, fs.realpathSync(walked.path))) {
                throw new Error('refusing to upload: a referenced source lies outside the input folder');
            }
        } else if ('url' in source) {
            try {
                normalizeUrl(source.url);
            } catch (err) {
                throw new Error('refusing to upload: ' + err.message);
            }
        } else {
            throw new Error('refusing to upload: a chunk map entry has no valid source');
        }
    }
}

// --- opening a chunk ------------------------------------------------------------------------

// {stream, size, mtime} of one chunk, or null when its source has no such object (the fill value).
// source: a chunk map entry's source; key: a chunk key of that array (checked by the caller).
async function openSource(source, key, {inputDir, fetch = globalThis.fetch} = {}) {
    if (!source || typeof source !== 'object') throw new ChunkMapError('no valid source');
    // chunk keys only: digits, separators and the v3 'c' prefix
    if (typeof key !== 'string' || !/^c?[0-9./]*$/.test(key)) throw new ChunkMapError('not a chunk key');
    const keySegs = segments(key);
    if ('input' in source) {
        const root = fs.realpathSync(path.resolve(inputDir));
        const walked = walkInput(root, [...segments(source.input), ...keySegs]);
        if (walked.missing) return null;
        let fd;
        try {
            // O_NOFOLLOW: the last segment cannot become a symlink after the walk
            fd = await fs.promises.open(walked.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            if (err.code === 'ELOOP') throw new ChunkMapError('a referenced source goes through a symlink');
            throw err;
        }
        try {
            if (!inside(root, fs.realpathSync(walked.path))) throw new ChunkMapError('a referenced source lies outside the input folder');
            const st = await fd.stat();
            if (!st.isFile()) throw new ChunkMapError('a referenced chunk is not a regular file');
            const stream = fs.createReadStream(null, {fd, autoClose: true});
            // the stream owns the descriptor now
            return {stream, size: st.size, mtime: st.mtime};
        } catch (err) {
            await fd.close();
            throw err;
        }
    }
    if ('url' in source) {
        let url = normalizeUrl(source.url) + '/' + key;
        for (let i = 0; i <= MAX_REDIRECTS; i++) {
            const res = await fetch(url, {redirect: 'manual', headers: {'Accept-Encoding': 'identity'}});
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get('location') || '';
                if (res.body) await res.body.cancel().catch(() => {});
                if (!location || !redirectAllowed(url, location)) throw new ChunkMapError('redirect to another host refused');
                url = new URL(location, url).href;
                continue;
            }
            if (MISSING_STATUS.has(res.status)) {
                if (res.body) await res.body.cancel().catch(() => {});
                return null;
            }
            const drop = async msg => {
                if (res.body) await res.body.cancel().catch(() => {});
                throw new ChunkMapError(msg);
            };
            if (res.status !== 200) return drop('a referenced chunk could not be read (HTTP ' + res.status + ')');
            const encoding = (res.headers.get('content-encoding') || 'identity').toLowerCase();
            if (encoding !== 'identity') return drop('a referenced chunk was sent encoded (' + encoding + ')');
            const length = res.headers.get('content-length');
            if (length === null || !/^[0-9]+$/.test(length)) return drop('a referenced chunk has no Content-Length');
            const size = Number(length);
            const stream = res.body ? Readable.fromWeb(res.body) : Readable.from([]);
            const lm = Date.parse(res.headers.get('last-modified') || '');
            return {stream, size, mtime: Number.isNaN(lm) ? new Date() : new Date(lm)};
        }
        throw new ChunkMapError('too many redirects');
    }
    throw new ChunkMapError('no valid source');
}

// --- what an object streams -----------------------------------------------------------------

// the referenced arrays inside a written directory: [{sub, meta}] (sub: the array dir below it)
function arraysUnder(chunkMap, fullpath) {
    if (!chunkMap) return [];
    const rel = path.relative(chunkMap.bidsDir, path.resolve(fullpath)).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return [];
    return Object.keys(chunkMap.arrays).sort()
        .filter(p => p.startsWith(rel + '/'))
        .map(p => ({sub: p.slice(rel.length + 1), meta: chunkMap.arrays[p]}));
}

// {bytes, upperBound, arrays}: bytes the chunks of these objects stream from their sources: input chunks are stat'ed,
// remote ones are counted at codec_bytes_hint (an upper bound; nothing is fetched)
function streamedBytes(chunkMap, datasets) {
    let bytes = 0, upperBound = false, arrays = 0;
    if (!chunkMap) return {bytes, upperBound, arrays};
    const inputReal = fs.realpathSync(chunkMap.inputDir);
    for (const item of datasets) {
        for (const full of Object.values(item.files || {})) {
            for (const {meta} of arraysUnder(chunkMap, full)) {
                arrays++;
                if (meta.source && 'url' in meta.source) {
                    bytes += keyCount(meta) * (Number(meta.codec_bytes_hint) || 0);
                    upperBound = true;
                    continue;
                }
                const base = path.join(inputReal, ...segments(meta.source.input));
                for (const key of chunkKeys(meta)) {
                    try {
                        const st = fs.lstatSync(path.join(base, ...key.split('/')));
                        if (st.isFile()) bytes += st.size;
                    } catch (err) {
                        // a missing chunk is the fill value
                    }
                }
            }
        }
    }
    return {bytes, upperBound, arrays};
}

module.exports = {
    CHUNK_MAP_VERSION, ChunkMapError, segments, chunkKeys, keyCount, keyOk, normalizeUrl, redirectAllowed,
    loadChunkMap, checkChunkMap, openSource, arraysUnder, streamedBytes,
};
