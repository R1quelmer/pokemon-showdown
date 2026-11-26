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
	it('updates selected badges for multiple accounts atomically and preserves account data', async () => {
		const store = fixture();
		const initial = await store.read();
		const registeredAt = '2026-11-25T20:00:00.000Z';
		initial.value.accounts.alpha = { name: 'Alpha', password: 'fixture', registeredAt,
			badges: ['Hisui'], avatar: 'cynthia', partner: { species: 'sylveon', shiny: true } };
		initial.value.accounts.beta = { name: 'Beta', password: 'fixture', registeredAt, badges: ['Paldea'] };
		initial.value.sessions.retained = { id: 'alpha', expires: 1 };
		await store.write(initial.value, initial.etag);
		const service = new CopaAccounts(store);
		await service.admin('award-badge', ['Alpha', 'Beta'], ['Johto', 'Kanto', 'Johto']);
		assert.deepEqual(store.value().accounts.alpha.badges, ['Kanto', 'Johto', 'Hisui']);
		assert.deepEqual(store.value().accounts.beta.badges, ['Kanto', 'Johto', 'Paldea']);
		const before = await store.read();
		await assert.rejects(service.admin('remove-badge', ['Alpha', 'Riquelme'], ['Kanto', 'Johto']), { status: 404 });
		await assert.rejects(service.admin('award-badge', ['Alpha'], ['Hoenn', 'invalid']), { status: 400 });
		await assert.rejects(service.admin('remove-badge', ['Alpha'], []), { status: 400 });
		assert.deepEqual(await store.read(), before);
		await service.admin('remove-badge', ['Alpha', 'Beta'], ['Kanto', 'Johto']);
		assert.deepEqual(store.value(), initial.value);
	});

	it('persists retroactive registration dates and preserves all other account data', async () => {
		const store = fixture();
		const initial = await store.read();
		initial.value.accounts.legacy = { name: 'Legacy', password: 'fixture', disabled: true,
			avatar: 'cynthia', partner: { species: 'sylveon', shiny: false } };
		initial.value.accounts.active = { name: 'Active', password: 'fixture' };
		initial.value.accounts.dated = { name: 'Dated', password: 'fixture', registeredAt: '2026-11-25T20:00:00.000Z' };
		initial.value.sessions.retained = { id: 'active', expires: 1 };
		await store.write(initial.value, initial.etag);
		const now = Date.parse('2026-11-26T15:00:00.000Z');
		const service = new CopaAccounts(store, () => now);
		assert.equal((await service.trainer('Active')).registeredAt, '2026-11-24T03:00:00.000Z');
		for (const id of ['legacy', 'active']) {
			Object.assign(initial.value.accounts[id], {
				registeredAt: '2026-11-24T03:00:00.000Z', registrationDateRetroactive: true,
			});
		}
		assert.deepEqual(store.value(), initial.value);
		const migrated = await store.read();
		await service.trainer('Active');
		assert.equal((await store.read()).etag, migrated.etag);
		await service.authenticate('register', 'Fresh Account', password);
		assert.equal(store.value().accounts.freshaccount.registeredAt, new Date(now).toISOString());
		assert.equal(store.value().accounts.freshaccount.registrationDateRetroactive, undefined);
	});

	it('validates trainer cards, separates badge permissions and persists observed results', async () => {
		const store = fixture();
		const service = new CopaAccounts(store);
		const { token } = await service.authenticate('register', 'Trainer Card', password);
		const card = {
			bio: 'Meu Dream Team', region: 'Hisui', banner: '',
			dreamTeam: [{ species: 'greninjamega', shiny: true }, null, { species: 'rotomwash', shiny: false }, null, null, null],
		};
		await assert.rejects(service.setTrainer('x'.repeat(43), card), { status: 401 });
		await assert.rejects(service.setTrainer(token, { ...card, dreamTeam: [{ species: 'sylveon', shiny: true }] }), { status: 400 });
		await assert.rejects(service.setTrainer(token, { ...card, banner: 'data:image/svg+xml;base64,PHN2Zz4=' }), { status: 400 });
		await assert.rejects(service.setTrainer(token, { ...card, region: 'Inexistente' }), { status: 400 });
		await service.setTrainer(token, { ...card, badges: ['Kanto'], stats: { wins: 999 } });
		await service.admin('award-badge', ['Trainer Card'], 'Hisui');
		await service.admin('award-badge', ['Trainer Card'], 'Hisui');
		await service.admin('award-badge', ['Trainer Card'], 'Paldea');
		await service.admin('remove-badge', ['Trainer Card'], 'Paldea');
		const players = [{ id: 'trainercard', account: 'trainercard' }, { id: 'opponent' }];
		await service.recordTrainerBattle(players, 'trainercard');
		await service.recordTrainerBattle(players, 'opponent');
		await service.recordTrainerBattle(players, '');
		const profile = await new CopaAccounts(store).trainer('trainercard');
		assert.deepEqual(profile.card, card);
		assert.deepEqual(profile.badges, ['Hisui']);
		assert.deepEqual(profile.stats, { total: 3, wins: 1, losses: 1 });
		assert.equal(typeof profile.registeredAt, 'string');
		assert.equal(Object.hasOwn(profile, 'password'), false);
		assert.equal((await service.publicMembers())[0].card, undefined);
		await service.admin('disable', ['Trainer Card']);
		assert.equal(await service.trainer('Trainer Card'), null);
	});

	it('lists active members, persists avatar choices and reuses the account cache for live presence', async () => {
		const { crqHandlers } = require('../../dist/server/chat-plugins/copa-rinha-online');
		const source = copaAccounts.source, copa = Config.copaRinhaSingleFormat;
		const store = fixture();
		let reads = 0;
		copaAccounts.source = { ...store, read() { reads++; return store.read(); } };
		Config.copaRinhaSingleFormat = true;
		const user = makeUser(), guest = makeUser(), official = makeUser('Official Only');
		const lobby = Rooms.get('lobby');
		const publicBattle = 'battle-member-public';
		const privateBattle = 'battle-member-private';
		const privateRoom = 'member-secret-room';
		const query = async () => (await crqHandlers.copapresence.call({}, 'members', null, true)).members;
		try {
			const account = await copaAccounts.authenticate('register', 'Zeta Member', password);
			await copaAccounts.authenticate('register', 'Alpha Member', password);
			await copaAccounts.authenticate('register', 'Disabled Member', password);
			await copaAccounts.admin('disable', ['Disabled Member']);
			const beforeOfficialAvatar = reads;
			await Chat.parse('/avatar dawn', null, official, official.connections[0]);
			assert.equal(official.avatar, 'dawn');
			assert.equal(reads, beforeOfficialAvatar);
			const connection = user.connections[0];
			connection.challenge = 'a'.repeat(256);
			await copaAccounts.grant(account.token, challenge);
			await user.rename('Zeta Member', 'copa', false, connection);
			await Chat.parse('/avatar cynthia', null, user, connection);
			assert.equal(store.value().accounts.zetamember.avatar, 'cynthia');
			const partner = { species: 'greninjamega', shiny: true };
			await copaAccounts.setPartner(account.token, partner);
			assert.deepEqual(store.value().accounts.zetamember.partner, partner);
			assert.equal(user.avatar, 'cynthia');
			user.joinRoom(lobby.roomid, connection);
			Rooms.rooms.set(publicBattle, { battle: { ended: false }, settings: {} });
			Rooms.rooms.set(privateBattle, { battle: { ended: false }, settings: { isPrivate: 'hidden' } });
			Rooms.rooms.set(privateRoom, { title: 'Private activity', type: 'chat', persist: true, settings: { modjoin: '+' } });
			user.games.add(privateBattle);
			user.games.add(publicBattle);
			user.inRooms.add(privateRoom);
			const startingReads = reads;
			const [result, second] = await Promise.all([query(), query()]);
			assert.deepEqual(result, second);
			assert.equal(reads - startingReads, 1);
			assert.deepEqual(result, [
				{ name: 'Alpha Member', avatar: 'unknown', online: false, rooms: [] },
				{ name: 'Zeta Member', avatar: 'cynthia', partner, online: true, rooms: [lobby.title], battle: publicBattle },
			]);
			Rooms.get(publicBattle).settings.isPrivate = true;
			assert.equal((await query())[1].battle, undefined);
			assert.equal(reads - startingReads, 1, 'presence changes do not reread R2');
			user.games.clear();
			user.inRooms.delete(privateRoom);
			user.disconnectAll();
			assert.deepEqual((await query())[1], { name: 'Zeta Member', avatar: 'cynthia', partner, online: false, rooms: [] });
			const reconnect = guest.connections[0];
			reconnect.challenge = 'b'.repeat(256);
			await copaAccounts.grant(account.token, '4|' + reconnect.challenge);
			await guest.rename('Zeta Member', 'copa', false, reconnect);
			assert.equal(reconnect.user.avatar, 'cynthia');
			await copaAccounts.admin('disable', ['Zeta Member']);
			assert.deepEqual((await query()).map(member => member.name), ['Alpha Member']);
		} finally {
			for (const roomid of [publicBattle, privateBattle, privateRoom]) Rooms.rooms.delete(roomid);
			user.games.clear();
			user.inRooms.delete(privateRoom);
			for (const participant of [user, guest, official]) {
				participant.disconnectAll();
				participant.destroy();
			}
			Object.assign(copaAccounts, { source, memberCache: undefined });
			Object.assign(Config, { copaRinhaSingleFormat: copa });
		}
	});
	it('allows verified Copa chat and PMs while enforcing native moderation and guest checks', async () => {
		const config = Config.copaRinhaSingleFormat;
		const source = copaAccounts.source;
		Config.copaRinhaSingleFormat = true;
		copaAccounts.source = fixture();
		const alice = makeUser(), bob = makeUser(), visitor = makeUser('Copa Chat Guest');
		const official = makeUser('Copa Chat Official');
		const lobby = Rooms.get('lobby');
		const lobbyModchat = lobby.settings.modchat;
		let battle;
		visitor.registered = false;
		const say = (user, room, target, message = 'hello') => new Chat.CommandContext({
			message, room, user, connection: user.connections[0],
		}).checkChat(message, room, target);
		try {
			for (const [index, user] of [alice, bob].entries()) {
				const name = index ? 'Copa Chat Bob' : 'Copa Chat Alice';
				const connection = user.connections[0];
				connection.challenge = String(index + 1).repeat(256);
				const session = await copaAccounts.authenticate('register', name, password);
				await copaAccounts.grant(session.token, '4|' + connection.challenge);
				await user.rename(name, 'copa', false, connection);
				assert.equal(user.registered, false);
				assert(!user.autoconfirmed);
			}
			const team = Teams.pack(Teams.import('Pikachu\n- Thunderbolt'));
			battle = Rooms.createBattle({
				format: 'gen9coparinhanationaldexza',
				players: [{ user: alice, team }, { user: bob, team }],
			});
			assert(battle && !battle.persist);
			assert(!alice.can('mute', null, battle));
			for (const user of [visitor, official]) {
				user.joinRoom(battle.roomid, user.connections[0]);
			}
			alice.joinRoom(lobby.roomid, alice.connections[0]);
			assert.equal(say(alice, battle), 'hello');
			assert.equal(say(alice, lobby, null, 'hello lobby'), 'hello lobby');
			assert.throws(() => say(alice, lobby, null, 'hello lobby'), /same message again/);
			assert.equal(say(alice, null, bob), 'hello');
			assert.equal(say(alice, null, official), 'hello');
			assert.equal(say(official, null, alice), 'hello');
			assert.throws(() => say(visitor, battle), Chat.Interruption);
			assert.throws(() => say(visitor, null, alice), Chat.Interruption);
			assert.throws(() => say(alice, null, visitor), /unregistered/);
			assert.throws(() => say(alice, battle, null, 'a'.repeat(1001)), /too long/);
			bob.settings.blockPMs = true;
			assert.throws(() => say(alice, null, bob), /blocking private messages/);
			lobby.settings.modchat = 'autoconfirmed';
			assert.throws(() => say(alice, lobby), Chat.Interruption);
			battle.mute(alice, 60000);
			assert.throws(() => say(alice, battle), /muted/);
			alice.connections[0].copaSession.expires = Date.now();
			assert.throws(() => say(alice, null, official), Chat.Interruption);
			assert.throws(() => say(official, null, alice), /unregistered/);
		} finally {
			lobby.settings.modchat = lobbyModchat;
			for (const user of [alice, bob, visitor, official]) {
				user.disconnectAll();
				user.destroy();
			}
			battle?.destroy();
			Object.assign(Config, { copaRinhaSingleFormat: config });
			Object.assign(copaAccounts, { source });
		}
	});
	it('HTTP API requires admin authorization, enforces login limits and sends no-store responses', async () => {
		const { PassThrough } = require('stream');
		const service = new CopaAccounts(fixture());
		const previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		async function request(action, data, authorization, splitBytes = false) {
			return new Promise(resolve => {
				const req = new PassThrough();
				req.url = '/copa-rinha/accounts/' + action;
				req.method = 'POST';
				req.headers = { origin: 'https://copa-rinha-client.onrender.com', 'content-type': 'application/json', authorization };
				req.socket = { remoteAddress: 'synthetic-account-http-test' };
				const headers = {};
				const res = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body), headers }); } };
				assert(handleAccountRequest(req, res, service));
				const bytes = Buffer.from(JSON.stringify(data));
				if (splitBytes) for (const byte of bytes) req.write(Buffer.from([byte]));
				req.end(splitBytes ? undefined : bytes);
			});
		}
		try {
			const denied = await request('admin', { action: 'list' });
			assert.equal(denied.status, 403);
			assert.equal((await request('admin', {
				action: 'award-badge', names: ['Riquelme'], regions: ['Kanto', 'Johto'],
			})).status, 403);
			assert.equal(denied.headers['Cache-Control'], 'no-store');
			const previousKey = process.env.COPA_RINHA_ADMIN_KEY;
			process.env.COPA_RINHA_ADMIN_KEY = 'A'.repeat(43); // Synthetic test key, never used by a deployment.
			try {
				const reserved = await request('admin', { action: 'reserve', names: ['HTTP Participant'] }, 'Bearer ' + 'A'.repeat(43));
				assert.equal(reserved.status, 200);
				const bulk = await request('admin', {
					action: 'award-badge', names: ['HTTP Participant'], regions: ['Kanto', 'Johto'],
				}, 'Bearer ' + 'A'.repeat(43));
				assert.equal(bulk.status, 404); // Reached the batch handler with valid regions, but the nickname is unregistered.
				const listed = await request('admin', { action: 'list' }, 'Bearer ' + 'A'.repeat(43));
				assert(listed.body.accounts.some(account => account.name === 'HTTP Participant'));
				assert(!JSON.stringify(listed.body).includes('password'));
				assert.equal((await request('admin', { action: 'list' }, 'A'.repeat(43))).status, 403);
			} finally {
				if (previousKey === undefined) delete process.env.COPA_RINHA_ADMIN_KEY;
				else Object.assign(process.env, { COPA_RINHA_ADMIN_KEY: previousKey });
			}

			const unicode = { name: 'Copa UTF8', password: 'senha-copa-única-🚀-928' };
			const registration = await request('register', unicode, undefined, true);
			assert.equal(registration.status, 200);
			const auth = 'Bearer ' + registration.body.token;
			const partner = { species: 'rotomwash', shiny: true };
			assert.equal((await request('partner', { partner })).status, 401);
			assert.equal((await request('partner', { partner: { species: 'notapokemon', shiny: false } }, auth)).status, 400);
			assert.equal((await request('partner', { partner }, auth)).status, 200);
			assert.deepEqual((await request('profile', { name: 'Copa UTF8' })).body.member,
				{ id: 'copautf8', name: 'Copa UTF8', avatar: 'unknown', partner });
			assert.equal((await request('partner', { partner: null }, auth)).status, 200);
			assert.equal((await request('profile', { name: 'Copa UTF8' })).body.member.partner, undefined);
			assert.equal((await request('login', unicode)).status, 200, 'UTF-8 survives chunk boundaries');
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
