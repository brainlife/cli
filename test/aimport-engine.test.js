'use strict';

const {describe, it, before, after} = require('node:test');
const assert = require('node:assert');
const http = require('http');
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

describe('Engine.start', () => {
    it('spawns docker, waits ready, stops by name', async () => {
        const calls = [];
        let srv;
        const spawn = (cmd, args, o) => {
            calls.push({cmd, args, o});
            const ee = new EventEmitter();
            ee.kill = () => {};
            if(args[0] === 'run') {
                const port = parseInt(args[args.indexOf('-p') + 1].split(':')[1]);
                http.createServer((req, res) => { res.end('{"stage":"idle"}'); }).listen(port, '127.0.0.1', function() { srv = this; });
            } else {
                setImmediate(() => ee.emit('exit', 0));
            }
            return ee;
        };
        const eng = await Engine.start({image: 'img', folder: '/in', work: '/w', keys: '/k', spawn, name: 'bl-test'});
        try {
            assert.strictEqual(calls[0].cmd, 'docker');
            assert.strictEqual(calls[0].o.env.AIMPORT_TOKEN, eng.token);
            assert.ok(!calls[0].args.some(a => a.includes(eng.token)));
            await eng.stop();
            assert.deepStrictEqual(calls[1].args, ['stop', 'bl-test']);
        } finally {
            srv.close();
        }
    });
});
