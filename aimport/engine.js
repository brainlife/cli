'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

// pinned until maintainers publish a tag
exports.ENGINE_IMAGE = 'brainlife/aimport:dev';

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
        'python', '-m', 'aimport', 'serve',
        '--input', '/data', '--work', '/work', '--keys', '/keys',
        '--host', '0.0.0.0', '--port', '8765',
        '--host-allow', `127.0.0.1:${port}`,
        '--host-allow', `localhost:${port}`,
    );
    return args;
}

function inside(child, parent) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// the keys folder must be separate from the work and input folders (either direction),
// and so must work and input (a re-scan would ingest the staged originals)
exports.checkFolders = function({folder, work, keys}) {
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

class Engine {
    constructor({base, token, spawn = child_process.spawn, name}) {
        this.base = base;
        this.token = token;
        this.spawn = spawn;
        this.name = name;
        this.child = null;
    }

    static async start(opts) {
        const port = await freePort();
        const token = crypto.randomBytes(32).toString('hex');
        const name = opts.name || 'bl-aimport-' + crypto.randomBytes(4).toString('hex');
        const spawn = opts.spawn || child_process.spawn;
        const args = exports.dockerArgs({...opts, port, name});
        const engine = new Engine({base: `http://127.0.0.1:${port}`, token, spawn, name});
        engine.child = spawn('docker', args, {
            env: {...process.env, AIMPORT_TOKEN: token},
            stdio: opts.stdio || 'ignore',
        });
        engine.exited = null;
        engine.child.on('error', err => { engine.exited = err; });
        engine.child.on('exit', code => { engine.exited = new Error(`docker exited with code ${code}`); });
        try {
            await engine.waitReady(opts.timeoutMs);
        } catch(err) {
            await engine.stop();
            throw err;
        }
        return engine;
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
            if(this.exited) throw this.exited;
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

    async stop() {
        if(!this.name) return;
        await new Promise(resolve => {
            try {
                const p = this.spawn('docker', ['stop', this.name], {stdio: 'ignore'});
                p.on('error', resolve);
                p.on('exit', resolve);
                p.on && p.on('close', resolve);
            } catch(err) {
                resolve();
            }
        });
    }
}

exports.Engine = Engine;
