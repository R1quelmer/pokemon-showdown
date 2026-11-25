'use strict';
const assert = require('assert').strict;
const { replayIndex, publicSummary } = require('../../dist/server/copa-replay-index');
const { saveBattle, handleReplayRequest, concealCopaReplay, FORMAT, CLIENT } = require('../../dist/server/copa-replays');
const id = 'a'.repeat(32);
const entryKey = '9999999999999-' + id + '.json';
const replay = (visibility = 'public') => ({ id, visibility, format: FORMAT, createdAt: '2026-11-24T12:00:00Z',
	players: [{ name: 'Alice', userid: 'alice' }, { name: 'Bob', userid: 'bob' }],
	winner: 'Alice', turns: 8, endType: 'forfeit', log: 'private battle log', roomid: 'battle-secret' });
function request(url, store, method = 'GET') {
	return new Promise(resolve => {
		const headers = {};
		assert(handleReplayRequest({ url, method, headers: { origin: CLIENT } }, {
			setHeader(k, v) { headers[k] = v; },
			end(body) { resolve({ status: this.statusCode, body: JSON.parse(body), headers }); },
		}, store));
	});
}
describe('Copa public replay index', () => {
	it('never indexes private, unlisted, legacy/unknown or malformed entries', async () => {
		const index = replayIndex({ send() { throw new Error('Must not access R2'); } }, 'test');
		for (const visibility of ['private', 'unlisted', undefined, 'unknown']) {
			const value = replay(visibility); value.visibility = visibility;
			assert.equal(publicSummary(value), null); await index.index(value);
		}
		assert.equal(publicSummary({ ...replay(), id: '../secret' }), null);
		assert.equal(publicSummary({ ...replay(), players: [] }), null);
	});
	it('writes only public metadata to newest-first global and exact-player indexes', async () => {
		const writes = [];
		const index = replayIndex({ async send(command) {
			if (command.constructor.name === 'GetObjectCommand') throw Object.assign(Error(), { name: 'NoSuchKey' });
			writes.push(command.input); return {};
		} }, 'test');
		await index.index(replay());
		assert.equal(writes.length, 4);
		assert.equal(writes[0].Key, 'replay-index/v1/records/' + id + '.json');
		assert(writes[1].Key.startsWith('replay-index/v1/all/'));
		assert(writes[2].Key.startsWith('replay-index/v1/player/alice/'));
		assert(writes[3].Key.startsWith('replay-index/v1/player/bob/'));
		assert(!writes[0].Body.includes('battle-secret')); assert(!writes[0].Body.includes('private battle log'));
		const olderKey = writes[1].Key;
		await index.index({ ...replay(), createdAt: '2026-11-25T12:00:00Z' });
		assert(writes[5].Key < olderKey);
	});
	it('paginates with twenty metadata keys, caches pages, and never enumerates replays/', async () => {
		const calls = [];
		const index = replayIndex({ async send(command) {
			calls.push(command);
			if (command.constructor.name === 'ListObjectsV2Command') {
				assert.equal(command.input.MaxKeys, 20);
				assert.equal(command.input.Prefix, 'replay-index/v1/player/alice/');
				return { Contents: [{ Key: command.input.Prefix + entryKey }], NextContinuationToken: 'nextToken' };
			}
			return { Body: { transformToString: async () => JSON.stringify(replay()) } };
		} }, 'test');
		const page = await index.list({ player: 'alice', cursor: '' });
		assert.equal(page.replays.length, 1); assert.equal(page.cursor, 'nextToken');
		assert(!Object.hasOwn(page.replays[0], 'log')); assert(!Object.hasOwn(page.replays[0], 'roomid'));
		await index.list({ player: 'alice', cursor: '' }); assert.equal(calls.length, 2);
		await index.list({ player: 'alice', cursor: 'nextToken' });
		assert.equal(calls[2].input.ContinuationToken, 'nextToken');
		assert(calls.every(command => !(command.input.Key || '').startsWith('replays/')));
	});
	it('skips nonpublic entries even if a stale/bad index object exists', async () => {
		const index = replayIndex({ async send(command) {
			if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'replay-index/v1/all/' + entryKey }] };
			return { Body: { transformToString: async () => JSON.stringify(replay('unknown')) } };
		} }, 'test');
		assert.deepEqual(await index.list({ player: '', cursor: '' }), { replays: [], cursor: null });
	});
	it('a private canonical record hides stale pointers even when deletion fails', async () => {
		let record = replay();
		const index = replayIndex({ async send(command) {
			if (command.constructor.name === 'PutObjectCommand') { record = JSON.parse(command.input.Body); return {}; }
			if (command.constructor.name === 'DeleteObjectCommand') throw Error('Delete failed');
			if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'replay-index/v1/all/' + entryKey }] };
			assert.equal(command.input.Key, 'replay-index/v1/records/' + id + '.json');
			return { Body: { transformToString: async () => JSON.stringify(record) } };
		} }, 'test');
		await assert.rejects(index.unindex(replay()));
		assert.deepEqual(await index.list({ player: '', cursor: '' }), { replays: [], cursor: null });
	});
	it('never revives a privacy tombstone during repair or a concurrent conditional create', async () => {
		for (const concurrent of [false, true]) {
			let reads = 0, writes = 0;
			const index = replayIndex({ async send(command) {
				if (command.constructor.name === 'GetObjectCommand') {
					if (concurrent && !reads++) throw Object.assign(Error(), { name: 'NoSuchKey' });
					return { Body: { transformToString: async () => JSON.stringify({ visibility: 'private' }) } };
				}
				writes++;
				assert.equal(command.input.IfNoneMatch, '*');
				throw Object.assign(Error('Conflict'), { $metadata: { httpStatusCode: 412 } });
			} }, 'test');
			await index.index(replay());
			assert.equal(writes, concurrent ? 1 : 0, 'no public metadata/pointers overwrite a private record');
		}
	});
	it('serves bounded, validated public search/pagination without exposing SDK errors', async () => {
		const store = { async list(query) { assert.deepEqual(query, { player: 'alice', cursor: 'next' }); return { replays: [], cursor: null }; } };
		const result = await request('/copa-rinha/replays/?player=alice&cursor=next', store);
		assert.equal(result.status, 200); assert.equal(result.headers['Access-Control-Allow-Origin'], CLIENT);
		assert.equal(result.headers['Cache-Control'], 'no-store');
		assert.equal((await request('/copa-rinha/replays/?player=../secret', store)).status, 400);
		assert.equal((await request('/copa-rinha/replays/?cursor=' + 'x'.repeat(2049), store)).status, 400);
		assert.equal((await request('/copa-rinha/replays/', store, 'POST')).status, 405);
		const error = await request('/copa-rinha/replays/', { async list() { throw Error('PRIVATE_CREDENTIAL'); } });
		assert.equal(error.status, 503); assert(!JSON.stringify(error).includes('PRIVATE_CREDENTIAL'));
	});
	it('hides a completed public replay without breaking its old ID and deletes every discovery key', async () => {
		const calls = [];
		const index = replayIndex({ async send(command) {
			if (command.constructor.name === 'GetObjectCommand') throw Object.assign(Error(), { name: 'NoSuchKey' });
			calls.push(command); return {};
		} }, 'test');
		let saved;
		const store = { ...index, async put(value) { saved = structuredClone(value); } };
		const room = { settings: {}, hideReplay: false, getLog: () => '|turn|1\n|win|Alice',
			add() { return { update() {} }; } };
		const pending = saveBattle({ format: FORMAT, roomid: 'battle-hide', endType: 'normal',
			players: [{ name: 'Alice' }, { name: 'Bob' }], room }, 'Alice', store);
		// A privacy change while the upload is in progress waits for the index write before removing it.
		room.hideReplay = true;
		await concealCopaReplay(room, store);
		const original = await pending;
		assert.equal(saved.id, original.id);
		assert.equal(saved.visibility, 'private');
		const writes = calls.filter(command => command.constructor.name === 'PutObjectCommand');
		const deletes = calls.filter(command => command.constructor.name === 'DeleteObjectCommand');
		assert.equal(deletes.length, 3);
		assert.deepEqual(deletes.map(command => command.input.Key), writes.filter(command => !command.input.Key.includes('/records/')).map(command => command.input.Key));
	});
	it('classifies native room visibility conservatively, preserves old links and contains index failures', async () => {
		const warnings = [], warn = console.warn;
		console.warn = value => warnings.push(value);
		try {
			for (const [flags, visibility] of [
				[{ settings: {}, hideReplay: false }, 'public'],
				[{ settings: { isPrivate: 'hidden' }, hideReplay: false }, 'private'],
				[{ settings: {}, hideReplay: true }, 'private'],
				[{ settings: {}, hideReplay: false, unlistReplay: true }, 'unlisted'], [{}, 'unknown'],
			]) {
				let announced = false, indexed = 0;
				const saved = await saveBattle({ format: FORMAT, roomid: 'battle-test', players: [{ name: 'Alice' }, { name: 'Bob' }],
					endType: 'forfeit', room: { ...flags, getLog: () => '|turn|8\n|win|Alice',
						add() { announced = true; return { update() {} }; } } }, 'Alice', {
					async put() {}, async index() { indexed++; throw Error('PRIVATE_CREDENTIAL'); },
				});
				assert.equal(saved.visibility, visibility); assert(announced);
				assert.equal(indexed, visibility === 'public' ? 1 : 0);
			}
		} finally { Object.assign(console, { warn }); }
		assert(warnings.some(value => value.includes('IndexReplay')));
		assert(!warnings.join('').includes('PRIVATE_CREDENTIAL'));
	});
});
