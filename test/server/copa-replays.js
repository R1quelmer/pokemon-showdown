'use strict';
const assert = require('assert').strict;
const { saveBattle, newID, validID, handleReplayRequest, FORMAT, CLIENT, replayFailure } = require('../../dist/server/copa-replays');
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
			const failingStore = {
				async put() {
					throw Object.assign(Error('SENSITIVE_TOKEN'), {
						name: 'AccessDenied', $metadata: { httpStatusCode: 403 },
						$request: { headers: { Authorization: 'SENSITIVE_TOKEN' } },
					});
				},
			};
			assert.equal(await saveBattle(b, 'Alice', failingStore), null);
		} finally {
			// No concurrent calls: restore the logger stub after the awaited operation.
			// eslint-disable-next-line ps/require-atomic-updates
			console.warn = warn;
		}
		assert(!b.room.message); assert(!JSON.stringify(messages).includes('SENSITIVE_TOKEN'));
		assert(messages[0].includes('PutObject'));
		assert(messages[0].includes('AccessDenied'));
		assert(messages[0].includes('403'));
	});
	it('diagnoses SDK errors using only recognized identifiers and numeric HTTP status', () => {
		const secret = 'DO_NOT_LOG_CREDENTIALS_OR_SIGNED_URL';
		const error = {
			name: 'SignatureDoesNotMatch', code: 'SignatureDoesNotMatch', statusCode: 403,
			$metadata: { httpStatusCode: 403, requestId: secret }, message: secret, stack: secret,
			$request: { headers: { Authorization: secret }, url: secret },
		};
		const info = replayFailure('PutObject', error);
		assert.equal(info.stage, 'PutObject');
		assert.equal(info.name, 'SignatureDoesNotMatch');
		assert.equal(info.code, 'SignatureDoesNotMatch');
		assert.equal(info.httpStatusCode, 403);
		assert.equal(info.metadataHttpStatusCode, 403);
		assert(!JSON.stringify(info).includes(secret));
		const hostile = replayFailure('PutObject', {
			name: secret, code: secret, cause: { code: secret }, statusCode: secret,
			$metadata: { httpStatusCode: secret },
		});
		assert(!JSON.stringify(hostile).includes(secret));
		assert.equal(hostile.name, 'UnrecognizedError');
		assert.equal(hostile.metadataHttpStatusCode, undefined);
		const network = replayFailure('PutObject', { name: 'TimeoutError', cause: { code: 'ETIMEDOUT' } });
		assert(network.timeout); assert(network.connection); assert.equal(network.causeCode, 'ETIMEDOUT');
		assert.equal(replayFailure('ConfigureR2', { name: 'ReplayConfigurationError' }).name, 'ReplayConfigurationError');
		for (const value of [null, undefined, secret, 42, { get name() { throw Error(secret); } }]) {
			assert(!JSON.stringify(replayFailure('PutObject', value)).includes(secret));
		}
	});
	it('generates a signed R2 PutObject with auto region and SDK virtual-hosted bucket addressing', () => {
		// Isolate module cache and fake environment. No real credentials or network access.
		const script = `
			const assert = require('assert').strict;
			const { S3Client } = require('@aws-sdk/client-s3');
			const original = S3Client.prototype.send;
			let handled = false;
			S3Client.prototype.send = function (command) {
				assert.equal(command.constructor.name, 'PutObjectCommand');
				assert.equal(command.input.Bucket, 'test-replay-bucket');
				assert.equal(command.input.Key, 'replays/test-id.json');
				assert.equal(command.input.ContentType, 'application/json');
				assert.equal(JSON.parse(command.input.Body).id, 'test-id');
				this.config.requestHandler.handle = async request => {
					handled = true;
					assert.equal(request.protocol, 'https:');
					assert.equal(request.hostname, 'test-replay-bucket.test-account.r2.cloudflarestorage.com');
					assert.equal(request.path, '/replays/test-id.json');
					assert.equal(request.method, 'PUT');
					assert(request.headers.authorization.includes('/auto/s3/aws4_request'));
					return { response: { statusCode: 200, headers: {}, body: Buffer.from('') } };
				};
				return original.call(this, command);
			};
			(async () => {
				await require('./dist/server/copa-replays').r2Storage().put({ id: 'test-id' });
				assert(handled);
			})().catch(() => { process.exitCode = 1; });
		`;
		require('child_process').execFileSync(process.execPath, ['-e', script], {
			cwd: require('path').resolve(__dirname, '../..'),
			env: {
				...process.env, R2_BUCKET: 'test-replay-bucket',
				R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
				R2_ACCESS_KEY_ID: 'test-access-key', R2_SECRET_ACCESS_KEY: 'test-secret-key',
			},
		});
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
