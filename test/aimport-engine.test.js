'use strict';

const {describe, it, before, after} = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const engine = require('../aimport/engine');

const {dockerArgs, checkFolders, Engine, EngineError, UsageError} = engine;

function listen(handler) {
    return new Promise(resolve => {
        const srv = http.createServer(handler);
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

describe('dockerArgs', () => {
    const opts = {image: 'img:1', folder: '/in', work: '/w', keys: '/k', port: 4321, name: 'bl-x'};
    const token = 'deadbeef'.repeat(8);

    it('has the contract flags and no token value', () => {
        const a = dockerArgs(opts);
        assert.ok(a.includes('127.0.0.1:4321:8765'));
        assert.ok(a.includes('/in:/data:ro'));
        assert.ok(a.includes('127.0.0.1:4321') && a.includes('localhost:4321'));
        assert.strictEqual(a[a.indexOf('--name') + 1], 'bl-x');
        assert.strictEqual(a[a.indexOf('AIMPORT_TOKEN') - 1], '-e');
        assert.ok(!a.some(x => x.includes(token)));
    });

    it('runs aimport with the venv python, not the image python', () => {
        const a = dockerArgs(opts);
        assert.deepStrictEqual(a.slice(a.indexOf('img:1') + 1, a.indexOf('img:1') + 5),
            ['/opt/aimport-venv/bin/python', '-m', 'aimport', 'serve']);
    });

    it('forwards ANTHROPIC_API_KEY by name only when set', () => {
        const saved = process.env.ANTHROPIC_API_KEY;
        try {
            delete process.env.ANTHROPIC_API_KEY;
            assert.ok(!dockerArgs(opts).includes('ANTHROPIC_API_KEY'));
            process.env.ANTHROPIC_API_KEY = 'sk-secret';
            const a = dockerArgs(opts);
            assert.strictEqual(a[a.indexOf('ANTHROPIC_API_KEY') - 1], '-e');
            assert.ok(!a.some(x => x.includes('sk-secret')));
        } finally {
            if(saved === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = saved;
        }
    });
});

describe('checkFolders', () => {
    it('refuses overlaps', () => {
        assert.throws(() => checkFolders({folder: '/in', work: '/w', keys: '/w/keys'}), UsageError);
        assert.throws(() => checkFolders({folder: '/in', work: '/w/sub', keys: '/w'}), UsageError);
        assert.throws(() => checkFolders({folder: '/in', work: '/w', keys: '/in/keys'}), UsageError);
        assert.throws(() => checkFolders({folder: '/in/sub', work: '/w', keys: '/in'}), UsageError);
    });
    it('refuses work inside the input folder and the input folder inside work', () => {
        assert.throws(() => checkFolders({folder: '/in', work: '/in/work', keys: '/k'}), /work folder/);
        assert.throws(() => checkFolders({folder: '/w/in', work: '/w', keys: '/k'}), /work folder/);
        assert.throws(() => checkFolders({folder: '/same', work: '/same', keys: '/k'}), UsageError);
    });
    it('refuses a keys folder that is a symlink into work', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aimport-folders-'));
        try {
            fs.mkdirSync(path.join(tmp, 'work', 'k'), {recursive: true});
            fs.mkdirSync(path.join(tmp, 'in'));
            fs.symlinkSync(path.join(tmp, 'work', 'k'), path.join(tmp, 'keys'));
            assert.throws(() => checkFolders({folder: path.join(tmp, 'in'), work: path.join(tmp, 'work'), keys: path.join(tmp, 'keys')}),
                UsageError);
            // a missing folder under the symlink is resolved too
            assert.throws(() => checkFolders({folder: path.join(tmp, 'in'), work: path.join(tmp, 'work'),
                keys: path.join(tmp, 'keys', 'new')}), UsageError);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });
    it('counts a child named ..foo as inside', () => {
        assert.throws(() => checkFolders({folder: '/in', work: '/in/..foo', keys: '/k'}), /work folder/);
        assert.throws(() => checkFolders({folder: '/in', work: '/w', keys: '/w/..keys'}), /keys folder/);
    });
    it('refuses paths with : or , (docker mount syntax)', () => {
        assert.throws(() => checkFolders({folder: '/in:x', work: '/w', keys: '/k'}), /must not contain/);
        assert.throws(() => checkFolders({folder: '/in', work: '/w,ro', keys: '/k'}), /must not contain/);
        assert.throws(() => checkFolders({folder: '/in', work: '/w', keys: '/k:/etc'}), /must not contain/);
    });
    it('accepts separate folders', () => {
        checkFolders({folder: '/in', work: '/w', keys: '/k'});
        checkFolders({folder: '/in', work: '/w', keys: '/w2'});
    });
});

describe('Engine api', () => {
    let srv, eng, seen;
    before(async () => {
        srv = await listen((req, res) => {
            seen = req.headers;
            if(req.url === '/busy') {
                res.writeHead(409, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({detail: 'busy: scanning'}));
            }
            if(req.url === '/bad') {
                res.writeHead(422, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({detail: [{loc: ['body'], msg: 'x'}]}));
            }
            if(req.url === '/events') {
                res.writeHead(200, {'Content-Type': 'text/event-stream'});
                res.write(': keepalive\n\n');
                res.write('data: {"stage": "scanning", "message": "go"}\n\n');
                res.write('data: {"stage": "planned", "message": "done"}\n\n');
                return; // left open; follow must close it
            }
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({stage: 'idle'}));
        });
        eng = new Engine({base: `http://127.0.0.1:${srv.address().port}`, token: 'tok'});
    });
    after(() => { srv.closeAllConnections(); srv.close(); });

    it('sends the bearer header', async () => {
        assert.deepStrictEqual(await eng.request('GET', '/status'), {stage: 'idle'});
        assert.strictEqual(seen.authorization, 'Bearer tok');
    });

    it('rejects non-2xx with EngineError', async () => {
        await assert.rejects(eng.request('POST', '/busy', {}), e => e instanceof EngineError && e.status === 409 && e.message === 'busy: scanning');
        await assert.rejects(eng.request('GET', '/bad'), e => e.status === 422 && e.message.includes('"msg":"x"'));
    });

    it('follows events to a terminal stage', async () => {
        const got = [];
        const r = await eng.follow(ev => got.push(ev.stage));
        assert.strictEqual(r.stage, 'planned');
        assert.deepStrictEqual(got, ['scanning', 'planned']);
    });
});

// a fake spawn for Engine.start: `run` answers on its port unless told otherwise
function fakeDocker({imagePresent = true, run = 'serve', stopHangs = false} = {}) {
    const calls = [];
    const servers = [];
    const children = [];
    const spawn = (cmd, args, o) => {
        calls.push({cmd, args, o});
        const ee = new EventEmitter();
        ee.kills = [];
        ee.kill = sig => { ee.kills.push(sig); };
        if(args[0] === 'run') {
            ee.exitCode = null;
            ee.stderr = new EventEmitter();
            children.push(ee);
            if(run === 'serve') {
                const port = parseInt(args[args.indexOf('-p') + 1].split(':')[1]);
                servers.push(http.createServer((req, res) => { res.end('{"stage":"idle"}'); }).listen(port, '127.0.0.1'));
            } else if(run === 'fail') {
                setImmediate(() => {
                    ee.stderr.emit('data', 'line 1\nline 2\nline 3\n');
                    ee.stderr.emit('data', 'line 4\nline 5\ndocker: Error response from daemon: port is already allocated.\n');
                    ee.exitCode = 125;
                    ee.emit('exit', 125, null);
                    ee.emit('close', 125, null);
                });
            }
        } else if(args[0] === 'image') {
            setImmediate(() => ee.emit('exit', imagePresent ? 0 : 1));
        } else if(args[0] === 'stop' && stopHangs) {
            // never exits
        } else {
            setImmediate(() => ee.emit('exit', 0));
        }
        return ee;
    };
    const close = () => servers.forEach(s => s.close());
    return {spawn, calls, children, close};
}

describe('Engine.start', () => {
    it('checks the image, spawns docker, waits ready, stops by name', async () => {
        const d = fakeDocker();
        const eng = await Engine.start({image: 'img', folder: '/in', work: '/w', keys: '/k', spawn: d.spawn, name: 'bl-test'});
        try {
            assert.deepStrictEqual(d.calls[0].args, ['image', 'inspect', 'img']);
            assert.strictEqual(d.calls[1].cmd, 'docker');
            assert.strictEqual(d.calls[1].args[0], 'run');
            assert.strictEqual(d.calls[1].o.env.AIMPORT_TOKEN, eng.token);
            assert.deepStrictEqual(d.calls[1].o.stdio, ['ignore', 'ignore', 'pipe']);
            assert.ok(!d.calls[1].args.some(a => a.includes(eng.token)));
            await eng.stop();
            assert.deepStrictEqual(d.calls[2].args, ['stop', '-t', '10', 'bl-test']);
            // the docker run child is still alive in the fake, so it gets SIGTERM
            assert.deepStrictEqual(d.children[0].kills, ['SIGTERM']);
        } finally {
            d.close();
        }
    });

    it('pulls a missing image with progress shown before docker run', async () => {
        const d = fakeDocker({imagePresent: false});
        const eng = await Engine.start({image: 'img', folder: '/in', work: '/w', keys: '/k', spawn: d.spawn, name: 'bl-test'});
        try {
            assert.deepStrictEqual(d.calls.map(c => c.args.slice(0, 2)), [['image', 'inspect'], ['pull', 'img'], ['run', '--rm']]);
            assert.strictEqual(d.calls[1].o.stdio, 'inherit');
            await eng.stop();
        } finally {
            d.close();
        }
    });

    it('reports docker\'s last stderr lines when docker run exits', async () => {
        const d = fakeDocker({run: 'fail'});
        await assert.rejects(Engine.start({image: 'img', folder: '/in', work: '/w', keys: '/k', spawn: d.spawn, name: 'bl-test'}), err => {
            assert.match(err.message, /^docker exited with code 125:/);
            assert.ok(err.message.includes('port is already allocated'));
            assert.ok(err.message.includes('line 2') && !err.message.includes('line 1'));
            return true;
        });
        assert.deepStrictEqual(d.calls[d.calls.length - 1].args, ['stop', '-t', '10', 'bl-test']);
        assert.deepStrictEqual(d.children[0].kills, []); // already exited
    });

    it('stop gives up on a hung docker stop and kills the docker run child', async () => {
        const d = fakeDocker({stopHangs: true});
        const eng = await Engine.start({image: 'img', folder: '/in', work: '/w', keys: '/k', spawn: d.spawn, name: 'bl-test',
            stopTimeoutMs: 50});
        try {
            await eng.stop();
            assert.deepStrictEqual(d.children[0].kills, ['SIGTERM']);
        } finally {
            d.close();
        }
    });
});
