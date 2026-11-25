'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ protocol = 'websocket-raw', supported = true, hasPing = true, throws = false } = {}) {
	let now = 0;
	const timers = new Set(), probes = [], closed = [];
	const module = { exports: {} };
	const file = path.resolve(__dirname, '../../dist/server/copa-connection-liveness.js');
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
		module, exports: module.exports,
		Date: { now: () => now },
		setInterval(callback, delay) {
			const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
			timers.add(timer); return timer;
		},
		clearInterval: timer => timers.delete(timer),
	}, { filename: file });
	const socket = new EventEmitter();
	socket.protocol = protocol;
	socket.close = (code, reason) => { closed.push({ code, reason }); socket.emit('close'); };
	if (hasPing) socket._session = { ws: { ping(message, callback) {
		if (throws) throw new Error('transport unavailable');
		probes.push({ message, callback }); return supported;
	} } };
	const cleanup = module.exports.watchCopaConnection(socket);
	const advance = milliseconds => {
		for (let elapsed = 0; elapsed < milliseconds; elapsed += 30000) {
			now += 30000;
			for (const timer of [...timers]) timer.callback();
		}
	};
	return { socket, timers, probes, closed, cleanup, advance };
}

describe('Copa raw WebSocket liveness', () => {
	it('leaves SockJS transports and unsupported raw transports on their native lifecycle', () => {
		for (const options of [{ protocol: 'websocket' }, { protocol: 'xhr-polling' }, { hasPing: false }]) {
			const f = fixture(options);
			f.advance(300000);
			assert.equal(f.timers.size, 0); assert.equal(f.probes.length, 0); assert.deepEqual(f.closed, []);
			f.cleanup();
		}
	});
	it('keeps an idle/background connection alive when the browser answers protocol pings', () => {
		const f = fixture();
		assert.equal([...f.timers][0].delay, 30000);
		assert.equal([...f.timers][0].unrefCalled, true);
		for (let i = 0; i < 100; i++) { f.advance(30000); f.probes.at(-1).callback(); }
		assert.equal(f.probes.length, 100); assert.deepEqual(f.closed, []);
		f.cleanup(); assert.equal(f.timers.size, 0);
	});
	it('allows the full pong grace period and closes an unresponsive socket through native close', () => {
		const f = fixture(); let nativeCloseEvents = 0;
		f.socket.on('close', () => nativeCloseEvents++);
		f.advance(30000); // first probe
		f.advance(60000); // still within its 90-second grace
		assert.equal(f.probes.length, 1); assert.deepEqual(f.closed, []);
		f.advance(30000);
		assert.deepEqual(f.closed, [{ code: 3000, reason: 'No response from heartbeat' }]);
		assert.equal(nativeCloseEvents, 1); assert.equal(f.timers.size, 0);
		assert.equal(f.socket.listenerCount('data'), 0);
		assert.equal(f.socket.listenerCount('close'), 1, 'the native close listener was preserved');
		f.advance(300000); assert.equal(f.closed.length, 1);
	});
	it('accepts delayed pong responses without disconnecting a legitimate slow connection', () => {
		const f = fixture(); f.advance(90000); f.probes[0].callback();
		f.advance(30000); assert.equal(f.probes.length, 2);
		f.advance(60000); f.probes[1].callback();
		assert.deepEqual(f.closed, []); f.cleanup();
	});
	it('incoming application traffic also proves liveness, without multiplying outstanding ping callbacks', () => {
		const f = fixture();
		for (let i = 0; i < 40; i++) { f.advance(30000); f.socket.emit('data', '|/cmd ping'); }
		assert.deepEqual(f.closed, []); assert.equal(f.probes.length, 1);
		f.advance(90000); assert.equal(f.closed.length, 1);
	});
	it('cleans up only its own listeners and ignores late pongs after closing a tab', () => {
		const f = fixture(); let otherData = 0, otherClose = 0;
		f.socket.on('data', () => otherData++); f.socket.on('close', () => otherClose++);
		f.advance(30000); f.socket.emit('close'); f.probes[0].callback();
		f.advance(300000); f.socket.emit('data', 'after close');
		assert.equal(f.timers.size, 0); assert.equal(otherData, 1); assert.equal(otherClose, 1);
		assert.deepEqual(f.closed, []); f.cleanup();
	});
	it('a dead connection never closes another connection or its reconnect replacement', () => {
		const old = fixture(), live = fixture();
		old.advance(120000);
		assert.equal(old.closed.length, 1); assert.deepEqual(live.closed, []);
		for (let i = 0; i < 10; i++) { live.advance(30000); live.probes.at(-1).callback(); }
		old.probes[0].callback(); old.cleanup();
		assert.deepEqual(live.closed, []); assert.equal(live.timers.size, 1); live.cleanup();
	});
	it('falls back safely if ping is unsupported or the underlying transport has already gone away', () => {
		for (const options of [{ supported: false }, { throws: true }]) {
			const f = fixture(options); f.advance(30000); f.advance(300000);
			assert.equal(f.timers.size, 0); assert.deepEqual(f.closed, []);
			assert.equal(f.socket.listenerCount('data'), 0);
		}
	});
	it('uses actual SockJS raw WebSockets and leaves a second idle tab connected when one tab closes', async () => {
		const server = http.createServer();
		const sockjs = require('sockjs').createServer({ prefix: '/showdown', log() {} });
		sockjs.installHandlers(server);
		const connections = [], clients = [], timers = new Set();
		let now = 0, pongs = 0;
		const module = { exports: {} };
		const file = path.resolve(__dirname, '../../dist/server/copa-connection-liveness.js');
		vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
			module, exports: module.exports, Date: { now: () => now },
			setInterval(callback) { const timer = { callback, unref() {} }; timers.add(timer); return timer; },
			clearInterval: timer => timers.delete(timer),
		});
		sockjs.on('connection', socket => {
			connections.push(socket);
			const ws = socket._session.ws;
			const ping = ws.ping.bind(ws);
			ws.ping = (message, callback) => ping(message, () => { pongs++; callback(); });
			module.exports.watchCopaConnection(socket);
		});
		const wait = async condition => {
			const deadline = Date.now() + 3000;
			while (!condition()) {
				assert(Date.now() < deadline, 'native WebSocket event arrived');
				await new Promise(resolve => { setTimeout(resolve, 10); });
			}
		};
		try {
			await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
			for (let i = 0; i < 2; i++) {
				const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/showdown/websocket`);
				clients.push(client);
				await new Promise((resolve, reject) => {
					client.addEventListener('open', resolve, { once: true });
					client.addEventListener('error', reject, { once: true });
				});
			}
			assert(connections.every(socket => socket.protocol === 'websocket-raw'));
			assert.equal(timers.size, 2);
			now += 30000; for (const timer of timers) timer.callback();
			await wait(() => pongs === 2);
			clients[0].close(); await wait(() => timers.size === 1);
			now += 30000; for (const timer of timers) timer.callback();
			await wait(() => pongs === 3);
			assert.equal(clients[1].readyState, WebSocket.OPEN);
			assert.equal(connections[0].listenerCount('data'), 0);
		} finally {
			for (const client of clients) client.close();
			await wait(() => timers.size === 0);
			await new Promise(resolve => { server.close(resolve); });
		}
	});
});
