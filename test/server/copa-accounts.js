'use strict';
const assert = require('assert').strict;
const { CopaAccounts, emptyRegistry, handleAccountRequest, copaAccounts } = require('../../dist/server/copa-accounts');
const { makeUser } = require('../users-utils');
function fixture() {
	let value = emptyRegistry(), version = 0;
	return { async read() { return { value: structuredClone(value), etag: String(version) }; },
		async write(next, etag) {
			if (etag !== String(version)) {
				const e = new Error('Conflict');
				e.$metadata = { httpStatusCode: 412 };
				throw e;
			}
			value = structuredClone(next);
			version++;
		},
		value: () => value };
}
const password = 'Copa fixture password 928';
const challenge = '4|' + 'a'.repeat(256);
describe('Copa private accounts', () => {
	it('HTTP API requires admin authorization, enforces login limits and sends no-store responses', async () => {
		const { PassThrough } = require('stream');
		const service = new CopaAccounts(fixture());
		const previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		async function request(action, data, authorization) {
			return new Promise(resolve => {
				const req = new PassThrough();
				req.url = '/copa-rinha/accounts/' + action;
				req.method = 'POST';
				req.headers = { origin: 'https://copa-rinha-client.onrender.com', 'content-type': 'application/json', authorization };
				req.socket = { remoteAddress: 'synthetic-account-http-test' };
				const headers = {};
				const res = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body), headers }); } };
				assert(handleAccountRequest(req, res, service));
				req.end(JSON.stringify(data));
			});
		}
		try {
			const denied = await request('admin', { action: 'list' });
			assert.equal(denied.status, 403);
			assert.equal(denied.headers['Cache-Control'], 'no-store');
			const previousKey = process.env.COPA_RINHA_ADMIN_KEY;
			process.env.COPA_RINHA_ADMIN_KEY = 'A'.repeat(43); // Synthetic test key, never used by a deployment.
			try {
				const reserved = await request('admin', { action: 'reserve', names: ['HTTP Participant'] }, 'Bearer ' + 'A'.repeat(43));
				assert.equal(reserved.status, 200);
				const listed = await request('admin', { action: 'list' }, 'Bearer ' + 'A'.repeat(43));
				assert(listed.body.accounts.some(account => account.name === 'HTTP Participant'));
				assert(!JSON.stringify(listed.body).includes('password'));
				assert.equal((await request('admin', { action: 'list' }, 'A'.repeat(43))).status, 403);
			} finally {
				if (previousKey === undefined) delete process.env.COPA_RINHA_ADMIN_KEY;
				else Object.assign(process.env, { COPA_RINHA_ADMIN_KEY: previousKey });
			}

			for (let i = 0; i < 11; i++) {
				const response = await request('login', { name: 'HTTP QA', password: 'wrong-password-value' });
				assert.equal(response.status, i === 10 ? 429 : 401);
				assert(!JSON.stringify(response.body).includes('scrypt'));
			}
		} finally {
			Object.assign(Config, { copaRinhaSingleFormat: previous });
		}
	});
	it('reserves Riquelme, permanently stores salted scrypt, persists across service instances and expires only sessions', async () => {
		let now = Date.now();
		const store = fixture(), accounts = new CopaAccounts(store, () => now);
		await assert.rejects(accounts.authenticate('register', 'Riquelme', password));
		const session = await accounts.authenticate('register', 'Copa Test Alpha', password);
		assert.match(store.value().accounts.copatestalpha.password, /^scrypt\$32768\$8\$3\$/);
		assert(!JSON.stringify(store.value()).includes(password));
		assert(!JSON.stringify(store.value()).includes(session.token));
		const restarted = new CopaAccounts(store, () => now);
		await restarted.grant(session.token, challenge);
		now += 31 * 86400000;
		await assert.rejects(restarted.grant(session.token, challenge));
		await assert.rejects(restarted.authenticate('register', 'Copa Test Alpha', password));
		assert((await restarted.authenticate('login', 'Copa Test Alpha', password)).token);
	});
	it('rejects bad passwords, duplicates, short passwords and forged or reused grants; supports two connections for one account', async () => {
		const accounts = new CopaAccounts(fixture());
		const session = await accounts.authenticate('register', 'Copa Test Beta', password);
		await assert.rejects(accounts.authenticate('login', 'Copa Test Beta', 'Different wrong password'));
		await assert.rejects(accounts.authenticate('register', 'Copa Test Beta', password));
		await assert.rejects(accounts.authenticate('register', 'Copa Test Short', 'short'));
		await assert.rejects(accounts.grant('x'.repeat(43), challenge));
		await accounts.grant(session.token, challenge);
		await assert.rejects(accounts.consume('b'.repeat(256), 'copatestbeta'));
		const first = await accounts.consume('a'.repeat(256), 'copatestbeta');
		await assert.rejects(accounts.consume('a'.repeat(256), 'copatestbeta'));
		await accounts.grant(session.token, '4|' + 'b'.repeat(256));
		const second = await accounts.consume('b'.repeat(256), 'copatestbeta');
		assert.equal(first.session, second.session);
	});
	it('revokes logout, supports bulk administration, single-use recovery and preserves registered nicknames', async () => {
		const accounts = new CopaAccounts(fixture());
		await accounts.admin('reserve', ['Player A', 'Player B']);
		await assert.rejects(accounts.authenticate('register', 'Player A', password));
		const recovery = await accounts.admin('recover', ['Player A']);
		const session = await accounts.recover(recovery.recovery, password);
		await assert.rejects(accounts.recover(recovery.recovery, password));
		await accounts.logout(session.token);
		await assert.rejects(accounts.grant(session.token, challenge));
		await assert.rejects(accounts.admin('release', ['Player A']));
		await accounts.admin('disable', ['Player A']);
		await assert.rejects(accounts.authenticate('login', 'Player A', password));
		await accounts.admin('enable', ['Player A']);
		assert((await accounts.authenticate('login', 'Player A', password)).token);
		await accounts.admin('release', ['Player B']);
		assert((await accounts.authenticate('register', 'Player B', password)).token);
	});
	it('creates a single permanent account under concurrent R2 conditional writes', async () => {
		const store = fixture();
		const a = new CopaAccounts(store), b = new CopaAccounts(store);
		const results = await Promise.allSettled([a.authenticate('register', 'Copa Atomic', password), b.authenticate('register', 'Copa Atomic', password)]);
		assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	});
	it('recovers reserved Riquelme administratively, revokes tokens, and retains registration permanently', async () => {
		let now = Date.now();
		const store = fixture();
		const service = new CopaAccounts(store, () => now);
		const invitation = await service.admin('recover', ['Riquelme']);
		const first = await service.recover(invitation.recovery, 'exclusive-copa-password');
		await assert.rejects(service.recover(invitation.recovery, 'another-exclusive-password'));
		await assert.rejects(service.authenticate('login', 'Riquelme', 'wrong-password-value'));
		const login = await service.authenticate('login', 'Riquelme', 'exclusive-copa-password');
		await service.grant(login.token, '4|' + 'a'.repeat(256));
		const proof = await service.consume('a'.repeat(256), 'riquelme');
		assert.equal(proof.id, 'riquelme');
		await assert.rejects(service.consume('a'.repeat(256), 'riquelme'));
		await service.logout(login.token);
		await assert.rejects(service.grant(login.token, '4|' + 'b'.repeat(256)));
		const reset = await service.admin('recover', ['Riquelme']);
		await assert.rejects(service.grant(first.token, '4|' + 'b'.repeat(256)));
		await service.recover(reset.recovery, 'new-exclusive-password');
		now += 31 * 86400000;
		const restarted = new CopaAccounts(store, () => now);
		assert(await restarted.protectedName('riquelme'));
		await assert.rejects(restarted.authenticate('register', 'Riquelme', 'new-exclusive-password'));
		await restarted.authenticate('login', 'Riquelme', 'new-exclusive-password');
		await assert.rejects(restarted.admin('release', ['Riquelme']));
	});
	it('isolates native official identities from local grants and preserves active users after a rejected merge', async () => {
		const previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		const official = makeUser('Official Guard'), visitor = makeUser();
		try {
			assert(official.registered);
			const result = await visitor.validateToken('copa', official.name, official.id, visitor.connections[0]);
			assert.equal(result, null);
			assert.equal(official.registered, true);
			assert.equal(official.connections.length, 1);
			assert.equal(visitor.copaAccountId, undefined);
		} finally {
			official.destroy();
			visitor.destroy();
			Object.assign(Config, { copaRinhaSingleFormat: previous });
		}
	});
	it('binds real native connections through challenge grants and keeps verified official assertions isolated', async () => {
		const config = Config.copaRinhaSingleFormat;
		const source = copaAccounts.source;
		const verify = global.Verifier;
		const created = [];
		Object.assign(Config, { copaRinhaSingleFormat: true });
		copaAccounts.source = fixture();
		global.Verifier = { ...verify, verify: async () => true }; // Test only the routing after the native cryptographic verification boundary.
		const guest = character => {
			const user = makeUser();
			user.connections[0].challenge = character.repeat(256);
			created.push(user);
			return user;
		};
		try {
			const session = await copaAccounts.authenticate('register', 'Copa Bound', 'private-fixture-password');
			const a = guest('a'), b = guest('b'), attacker = guest('c'), official = guest('d');
			for (const user of [a, b]) {
				const connection = user.connections[0];
				await copaAccounts.grant(session.token, '4|' + connection.challenge);
				await user.rename('Copa Bound', 'copa', false, connection);
			}
			assert.equal(Users.get('copabound').connections.length, 2);
			assert.equal(Users.get('copabound').registered, false);
			const owner = Users.get('copabound');
			owner.newNames = 3;
			owner.lastNewNameTime = Date.now();
			const connection = owner.connections[0];
			const renewed = await copaAccounts.authenticate('login', 'Copa Bound', 'private-fixture-password');
			await copaAccounts.grant(renewed.token, '4|' + connection.challenge);
			await owner.rename('Copa Bound', 'copa', false, connection);
			assert.equal(owner.newNames, 3);
			assert.equal(owner.connections.length, 2);
			await attacker.rename('Copa Bound', '', false, attacker.connections[0]);
			assert.equal(attacker.named, false);
			const assertion = type => `${official.connections[0].challenge},copabound,${type},${Math.floor(Date.now() / 1000)},;fixture-signature`;
			assert.equal(await official.validateToken(assertion('1'), 'Copa Bound', 'copabound', official.connections[0]), null);
			await official.rename('Copa Bound', assertion('2'), false, official.connections[0]);
			assert.equal(Users.get('copabound').registered, true);
			const e = guest('e');
			await copaAccounts.grant(session.token, '4|' + e.connections[0].challenge);
			await e.rename('Copa Bound', 'copa', false, e.connections[0]);
			assert.equal(e.named, false);
			assert.equal(official.connections.length, 1);
			assert(official.registered);
		} finally {
			for (const user of created) {
				user.disconnectAll();
				user.destroy();
			}
			Object.assign(Config, { copaRinhaSingleFormat: config });
			Object.assign(copaAccounts, { source });
			Object.assign(global, { Verifier: verify });
		}
	});
	it('requires logout before changing the account of an existing shared User', async () => {
		const previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		const user = makeUser('Copa Account One');
		try {
			user.copaAccountId = user.id;
			for (const token of ['copa', '']) {
				assert.equal(await user.validateToken(token, 'Other Account', 'otheraccount', user.connections[0]), null);
				assert.equal(user.copaAccountId, 'copaaccountone');
				assert.equal(user.id, 'copaaccountone');
			}
		} finally {
			user.disconnectAll(); user.destroy();
			Object.assign(Config, { copaRinhaSingleFormat: previous });
		}
	});
	it('native local merge requires matching account proof and never marks a local account officially registered', () => {
		const previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		const a = makeUser('Copa Merge'), b = makeUser();
		a.registered = false;
		const id = a.id;
		try {
			a.copaAccountId = id;
			b.copaAccountId = id;
			b.connections[0].copaSession = { id, session: 'hash', expires: Date.now() + 60000 };
			b.handleRename(a.name, id, false, '1');
			assert.equal(a.connections.length, 2);
			assert.equal(a.registered, false);
			a.connections[0].destroy();
			assert(a.connected);
			a.connections[0].destroy();
			assert(!a.connected);
		} finally {
			a.destroy();
			b.destroy();
			Object.assign(Config, { copaRinhaSingleFormat: previous });
		}
	});
});
