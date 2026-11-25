'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

// pinned until maintainers publish a tag
exports.ENGINE_IMAGE = 'brainlife/aimport:1.9.0';

// the image's own python is 2.7; aimport lives in this venv
exports.ENGINE_PYTHON = '/opt/aimport-venv/bin/python';

// forwarded by name only (-e NAME) so values never show in the process list
exports.MODEL_ENV = ['AIMPORT_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_BASE_URL', 'DASHSCOPE_API_KEY'];

const TERMINAL = ['planned', 'validated', 'invalid', 'failed'];

class EngineError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'EngineError';
        this.status = status;
    }
}

class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UsageError';
    }
}

exports.EngineError = EngineError;
exports.UsageError = UsageError;

// the docker argument list; the token is not in it (it travels in the child's environment)
exports.dockerArgs = function({image, folder, work, keys, port, name}) {
    const args = ['run', '--rm', '--platform', 'linux/amd64'];
    if(name) args.push('--name', name);
    args.push('-e', 'AIMPORT_TOKEN');
    for(const v of exports.MODEL_ENV) {
        if(process.env[v]) args.push('-e', v);
    }
    args.push(
        '-p', `127.0.0.1:${port}:8765`,
        '-v', `${folder}:/data:ro`,
        '-v', `${work}:/work`,
        '-v', `${keys}:/keys`,
        image || exports.ENGINE_IMAGE,
        exports.ENGINE_PYTHON, '-m', 'aimport', 'serve',
        '--input', '/data', '--work', '/work', '--keys', '/keys',
        '--host', '0.0.0.0', '--port', '8765',
        '--host-allow', `127.0.0.1:${port}`,
        '--host-allow', `localhost:${port}`,
    );
    return args;
}

// the real path of p, following symlinks in the part that exists
function real(p) {
    p = path.resolve(p);
    const rest = [];
    for(;;) {
        try {
            return path.join(fs.realpathSync(p), ...rest);
        } catch(err) {
            const parent = path.dirname(p);
            if(parent === p) return path.join(p, ...rest);
            rest.unshift(path.basename(p));
            p = parent;
        }
    }
}

function inside(child, parent) {
    const rel = path.relative(real(parent), real(child));
    if(rel === '') return true;
    return !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}

// the keys folder must be separate from the work and input folders (either direction),
// and so must work and input (a re-scan would ingest the staged originals)
exports.checkFolders = function({folder, work, keys}) {
    // docker -v splits on ':' (and --mount on ',')
    for(const [name, dir] of [['input', folder], ['work', work], ['keys', keys]]) {
        if(/[:,]/.test(dir)) throw new UsageError(`the ${name} folder path must not contain ':' or ',': ${dir}`);
    }
    for(const [name, other] of [['work', work], ['input', folder]]) {
        if(inside(keys, other) || inside(other, keys)) {
            throw new UsageError(`the keys folder (${keys}) must not be inside or contain the ${name} folder (${other})`);
        }
    }
    if(inside(work, folder) || inside(folder, work)) {
        throw new UsageError(`the work folder (${work}) must not be inside or contain the input folder (${folder})`);
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

function errorMessage(text) {
    try {
        const body = JSON.parse(text);
        if(body && body.detail !== undefined) {
            return typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        }
    } catch(err) {
        //not json
    }
    return text;
}

// run a docker command to the end; resolves its exit code
function docker(spawn, args, stdio) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, v) => {
            if(done) return;
            done = true;
            fn(v);
        };
        const p = spawn('docker', args, {stdio});
        p.on('error', err => finish(reject, err));
        p.on('exit', code => finish(resolve, code));
        p.on('close', code => finish(resolve, code));
    });
}

// pull the image first (with docker's own progress) so the ready timeout covers startup only
async function ensureImage(spawn, image) {
    if(await docker(spawn, ['image', 'inspect', image], 'ignore') === 0) return;
    console.error(`Pulling ${image} (first run; this can take a while)...`);
    const code = await docker(spawn, ['pull', image], 'inherit');
    if(code !== 0) throw new Error(`docker pull ${image} failed (code ${code})`);
}

const STDERR_KEEP = 20;

class Engine {
    constructor({base, token, spawn = child_process.spawn, name}) {
        this.base = base;
        this.token = token;
        this.spawn = spawn;
        this.name = name;
        this.child = null;
        this.stderr = '';
        this.exitCode = null;
        this.spawnError = null;
        this.stopTimeoutMs = 30000;
    }

    static async start(opts) {
        const spawn = opts.spawn || child_process.spawn;
        const image = opts.image || exports.ENGINE_IMAGE;
        try {
            await ensureImage(spawn, image);
        } catch(err) {
            throw new Error('docker could not get the engine image: ' + err.message);
        }
        const port = await freePort();
        const token = crypto.randomBytes(32).toString('hex');
        const name = opts.name || 'bl-aimport-' + crypto.randomBytes(4).toString('hex');
        const args = exports.dockerArgs({...opts, image, port, name});
        const engine = new Engine({base: `http://127.0.0.1:${port}`, token, spawn, name});
        if(opts.stopTimeoutMs) engine.stopTimeoutMs = opts.stopTimeoutMs;
        engine.child = spawn('docker', args, {
            env: {...process.env, AIMPORT_TOKEN: token},
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        engine.child.on('error', err => { engine.spawnError = err; });
        // 'close' comes after stderr is read to the end
        engine.child.on('close', (code, signal) => { engine.exitCode = code !== null && code !== undefined ? code : (signal || 'unknown'); });
        if(engine.child.stderr) {
            // keep the last lines only (docker's own errors, e.g. a port or mount problem)
            engine.child.stderr.on('data', d => {
                engine.stderr = (engine.stderr + d).split('\n').slice(-STDERR_KEEP - 1).join('\n');
            });
        }
        try {
            await engine.waitReady(opts.timeoutMs);
        } catch(err) {
            await engine.stop();
            throw err;
        }
        return engine;
    }

    // why the docker run child is gone, or null while it runs
    exitError() {
        if(this.spawnError) return this.spawnError;
        if(this.exitCode === null) return null;
        const last = this.stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n');
        return new Error(`docker exited with code ${this.exitCode}` + (last ? ':\n' + last : ''));
    }

    request(method, path, body) {
        return new Promise((resolve, reject) => {
            const headers = {Authorization: 'Bearer ' + this.token};
            let data = null;
            if(body !== undefined) {
                data = Buffer.from(JSON.stringify(body));
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = data.length;
            }
            const req = http.request(this.base + path, {method, headers}, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString();
                    if(res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new EngineError(errorMessage(text), res.statusCode));
                    }
                    if(!text) return resolve({});
                    try {
                        resolve(JSON.parse(text));
                    } catch(err) {
                        reject(new EngineError('bad answer from the engine: ' + text.slice(0, 200), res.statusCode));
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            if(data) req.write(data);
            req.end();
        });
    }

    // read /events until a terminal stage; calls onEvent for every event
    follow(onEvent) {
        return new Promise((resolve, reject) => {
            const req = http.get(this.base + '/events', {headers: {Authorization: 'Bearer ' + this.token}}, res => {
                if(res.statusCode < 200 || res.statusCode >= 300) {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => reject(new EngineError(errorMessage(Buffer.concat(chunks).toString()), res.statusCode)));
                    return;
                }
                res.setEncoding('utf8');
                let buf = '';
                let done = false;
                const finish = (fn, v) => {
                    if(done) return;
                    done = true;
                    req.destroy();
                    fn(v);
                };
                const line = l => {
                    if(!l.startsWith('data:')) return; //keepalives (": ...") and blanks
                    let ev;
                    try {
                        ev = JSON.parse(l.slice(5).trim());
                    } catch(err) {
                        return;
                    }
                    if(onEvent) onEvent(ev);
                    if(TERMINAL.includes(ev.stage)) finish(resolve, {stage: ev.stage, message: ev.message});
                };
                res.on('data', chunk => {
                    buf += chunk;
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    lines.forEach(l => !done && line(l.replace(/\r$/, '')));
                });
                res.on('end', () => finish(reject, new Error('the engine closed the event stream before the run finished')));
                res.on('error', err => finish(reject, err));
            });
            req.on('error', reject);
        });
    }

    async waitReady(timeoutMs = 120000) {
        const start = Date.now();
        let last;
        while(Date.now() - start < timeoutMs) {
            const exited = this.exitError();
            if(exited) throw exited;
            try {
                await this.request('GET', '/status');
                return;
            } catch(err) {
                last = err;
                if(err instanceof EngineError && err.status === 401) throw err;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('the engine did not become ready' + (last ? ': ' + last.message : ''));
    }

    // docker stop (10 s grace) with a watchdog, then make sure the docker run child is gone
    async stop() {
        if(!this.name) return;
        await new Promise(resolve => {
            let timer = null;
            let p = null;
            const finish = () => {
                clearTimeout(timer);
                resolve();
            };
            timer = setTimeout(() => {
                try {
                    if(p && p.kill) p.kill('SIGKILL');
                } catch(err) {
                    //already gone
                }
                finish();
            }, this.stopTimeoutMs);
            try {
                p = this.spawn('docker', ['stop', '-t', '10', this.name], {stdio: 'ignore'});
                p.on('error', finish);
                p.on('exit', finish);
                p.on('close', finish);
            } catch(err) {
                finish();
            }
        });
        if(this.child && this.child.exitCode === null && this.child.kill) {
            try {
                this.child.kill('SIGTERM');
            } catch(err) {
                //already gone
            }
        }
    }
}

exports.Engine = Engine;
