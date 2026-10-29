'use strict';
const assert = require('assert').strict;
const { saveBattle, newID, validID, handleReplayRequest, FORMAT, CLIENT } = require('../../dist/server/copa-replays');
describe('Copa Rinha replays', () => {
	const protocol = ['|player|p1|Alice|', '|player|p2|Bob|', '|turn|7', '|-mega|p1a: Venusaur|Venusaur|Venusaurite', '|-zpower|p2a: Pikachu', '|-terastallize|p1a: Garchomp|Ground', '|-start|p2a: Pikachu|Dynamax', '|detailschange|p2a: Pikachu|Pikachu-Gmax, L100', '|win|Alice'].join('\n');
	function battle(format = FORMAT, endType = 'normal') {
		return { format, endType, roomid: 'battle-test-1', players: [{ name: 'Alice' }, { name: 'Bob' }], room: { getLog: () => protocol + '\n|c|Alice|secret chat\n|c:|123|Bob|more chat', add(message) { this.message = message; return { update() {} }; } } };
	}
	it('generates secure URL-safe IDs', () => {
		const ids = new Set(Array.from({ length: 1000 }, newID));
		assert.equal(ids.size, 1000);
		for (const id of ids) assert(validID(id));
		for (const id of ['', '../secret', 'x'.repeat(33), '%2f', 'x'.repeat(31)]) assert(!validID(id));
	});
	it('saves metadata and all gimmick protocol, removes human chat, announces only after upload', async () => {
		const b = battle();
		let saved;
		const replay = await saveBattle(b, 'Alice', { async put(r) { assert(!b.room.message); saved = r; } });
		assert.equal(saved, replay);
		assert.deepEqual(replay.players, [{ name: 'Alice', userid: 'alice' }, { name: 'Bob', userid: 'bob' }]);
		assert.equal(replay.winner, 'Alice'); assert.equal(replay.winnerid, 'alice');
		assert.equal(replay.turns, 7); assert.equal(replay.endType, 'normal');
		assert.equal(replay.roomid, b.roomid); assert.equal(replay.format, FORMAT);
		assert(Number.isFinite(Date.parse(replay.createdAt)));
		assert.equal(replay.log, protocol);
		assert(b.room.message.includes(`${CLIENT}/replay.html?id=${replay.id}`));
	});
	it('skips other formats', async () => {
		assert.equal(await saveBattle(battle('gen9ou'), 'Alice', { put() { throw Error('must not upload'); } }), null);
	});
	it('records forfeits and ties', async () => {
		const store = { async put() {} };
		assert.equal((await saveBattle(battle(FORMAT, 'forfeit'), 'Bob', store)).endType, 'forfeit');
		const tie = await saveBattle(battle(), '', store);
		assert.equal(tie.endType, 'tie'); assert.equal(tie.winnerid, '');
	});
	it('contains storage failures and never exposes credentials or announces success', async () => {
		const b = battle(); const messages = []; const warn = console.warn;
		console.warn = message => messages.push(message);
		try {
			assert.equal(await saveBattle(b, 'Alice', { async put() { throw Error('SENSITIVE_TOKEN'); } }), null);
		} finally {
			// No concurrent calls: restore the logger stub after the awaited operation.
			// eslint-disable-next-line ps/require-atomic-updates
			console.warn = warn;
		}
		assert(!b.room.message); assert(!JSON.stringify(messages).includes('SENSITIVE_TOKEN'));
	});
	function request(id, store, origin = CLIENT, method = 'GET') {
		return new Promise(resolve => {
			const headers = {};
			const res = { setHeader(k, v) { headers[k] = v; }, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body), headers }); } };
			assert(handleReplayRequest({ url: '/copa-rinha/replays/' + id, headers: { origin }, method }, res, store));
		});
	}
	it('serves JSON, missing, invalid, storage errors, method and scoped CORS', async () => {
		const id = newID();
		assert.equal((await request(id, { async get() { return { id }; } })).body.id, id);
		assert.equal((await request(id, { async get() { return null; } })).status, 404);
		assert.equal((await request('../bad')).status, 400);
		const failed = await request(id, { async get() { throw Error('SENSITIVE_TOKEN'); } });
		assert.equal(failed.status, 503); assert(!JSON.stringify(failed).includes('SENSITIVE_TOKEN'));
		assert.equal(failed.headers['Access-Control-Allow-Origin'], CLIENT);
		assert(!(await request(id, { async get() { return null; } }, 'https://evil.example')).headers['Access-Control-Allow-Origin']);
		assert.equal((await request(id, null, CLIENT, 'POST')).status, 405);
	});
});
