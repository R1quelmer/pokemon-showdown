'use strict';

const assert = require('assert').strict;
const { makeConnection, makeUser } = require('../users-utils');
const { crqHandlers } = require('../../dist/server/chat-plugins/copa-rinha-online');

describe('Copa Rinha public online presence', () => {
	let originalCopa, originalEmergency, created;
	const query = trustable => crqHandlers.copapresence.call({}, '', null, trustable ?? true);
	const create = name => {
		const user = makeUser(name);
		created.push(user);
		return user;
	};
	beforeEach(() => {
		originalCopa = Config.copaRinhaSingleFormat;
		originalEmergency = Config.emergency;
		Config.copaRinhaSingleFormat = true;
		created = [];
	});
	afterEach(() => {
		Config.copaRinhaSingleFormat = originalCopa;
		Config.emergency = originalEmergency;
		for (const user of created) {
			user.disconnectAll();
			if (Users.users.get(user.id) === user) user.destroy();
		}
	});
	it('counts connected guests but exposes only their aggregate count', () => {
		const baseline = query(), guest = create();
		const result = query();
		assert.equal(result.guests, baseline.guests + 1);
		assert.equal(result.total, baseline.total + 1);
		assert.deepEqual(result.users, baseline.users);
		const serialized = JSON.stringify(result);
		assert(!serialized.includes(guest.name)); assert(!serialized.includes(guest.id));
		guest.connections[0].onDisconnect();
		assert.equal(Users.users.has(guest.id), false, 'native guest cleanup is immediate');
		assert.deepEqual(query(), baseline);
	});
	it('counts a named user once across multiple connections and removes it only after the last closes', () => {
		const baseline = query(), user = create('CopaRosterAlice');
		const first = user.connections[0], second = makeConnection();
		user.mergeConnection(second);
		assert.equal(query().total, baseline.total + 1);
		assert.equal(query().users.filter(row => row.name === user.name).length, 1);
		first.onDisconnect();
		assert.equal(user.connected, true); assert.equal(user.connections.length, 1);
		assert.equal(query().total, baseline.total + 1);
		second.onDisconnect();
		assert.equal(user.connected, false);
		assert.equal(Users.users.has(user.id), true, 'native offline cache may retain a named user');
		assert.deepEqual(query(), baseline, 'offline cache entries are not online');
	});
	it('reflects refresh, disconnect and native reconnection without duplicating the prior identity', () => {
		const baseline = query(), user = create('CopaRosterRefresh');
		user.connections[0].onDisconnect();
		const guest = create();
		assert.equal(query().guests, baseline.guests + 1);
		user.merge(guest);
		assert.equal(query().guests, baseline.guests);
		assert.equal(query().total, baseline.total + 1);
		assert.equal(query().users.filter(row => row.name === user.name).length, 1);
		assert.equal(guest.connected, false);
	});
	it('excludes inconsistent entries with no live connections and deduplicates normalized users', () => {
		const baseline = query(), user = create('CopaRosterUnique');
		const alias = 'coparosterinternalalias';
		Users.users.set(alias, user);
		try {
			assert.equal(query().total, baseline.total + 1);
			assert.equal(query().users.filter(row => row.name === user.name).length, 1);
			const connections = user.connections;
			try {
				user.connections = [];
				assert.deepEqual(query(), baseline);
			} finally { user.connections = connections; }
		} finally { Users.users.delete(alias); }
	});
	it('returns only public identity/avatar/status fields and updates status on the next query', () => {
		const user = create('CopaRosterPublic');
		user.avatar = 'copa-public-avatar'; user.userMessage = 'Pronto para jogar'; user.statusType = 'busy';
		const result = query(), row = result.users.find(entry => entry.name === user.name);
		assert.deepEqual(Object.keys(result).sort(), ['guests', 'total', 'users']);
		assert.deepEqual(Object.keys(row).sort(), ['avatar', 'inBattle', 'name', 'status', 'statusType']);
		assert.equal(row.avatar, 'copa-public-avatar'); assert.equal(row.statusType, 'busy');
		assert.equal(row.status, '!(Busy) Pronto para jogar');
		const serialized = JSON.stringify(result);
		assert(!serialized.includes(user.latestIp)); assert(!serialized.includes(user.connections[0].id));
		for (const privateKey of ['ip', 'ips', 'connections', 'connectionid', 'rooms', 'registered', 'userid', 'lastConnected']) {
			assert(!Object.hasOwn(row, privateKey), privateKey);
		}
		user.statusType = 'idle'; user.userMessage = '';
		assert.equal(query().users.find(entry => entry.name === user.name).status, '!(Idle) ');
	});
	it('reports an active battle without exposing its room, opponents or private settings', () => {
		const user = create('CopaRosterBattle'), roomid = 'battle-presence-private';
		Rooms.rooms.set(roomid, { battle: { ended: false }, settings: { isPrivate: true } });
		user.games.add(roomid);
		try {
			const row = query().users.find(entry => entry.name === user.name);
			assert.equal(row.inBattle, true);
			assert(!JSON.stringify(row).includes(roomid));
			Rooms.get(roomid).battle.ended = true;
			assert.equal(query().users.find(entry => entry.name === user.name).inBattle, false);
		} finally { user.games.delete(roomid); Rooms.rooms.delete(roomid); }
	});
	it('is additive to native /cmd and honors the existing emergency trust gate', () => {
		Chat.loadPlugins();
		assert.equal(typeof Chat.crqHandlers.copapresence, 'function');
		const guest = create(), connection = guest.connections[0], messages = [];
		connection.send = message => messages.push(message);
		Config.emergency = false;
		Chat.parse('/cmd copapresence', null, guest, connection);
		const prefix = '|queryresponse|copapresence|';
		assert(messages.at(-1).startsWith(prefix));
		assert.deepEqual(JSON.parse(messages.at(-1).slice(prefix.length)), query());
		Config.emergency = true;
		Chat.parse('/cmd copapresence', null, guest, connection);
		assert.equal(messages.at(-1), prefix + 'false');
		assert.equal(query(false), false);
	});
	it('does not expose a global roster outside the Copa Rinha preset', () => {
		Config.copaRinhaSingleFormat = false;
		assert.equal(query(), false);
	});
});
