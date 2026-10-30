'use strict';
const assert = require('assert').strict;
const { playerFormatAllowed, COPA_FORMAT, COPA_ONLY_MESSAGE } = require('../../dist/server/copa-format-policy');
const { Ladders } = require('../../dist/server/ladders');
const { makeUser } = require('../users-utils');
describe('Copa Rinha public single-format policy', () => {
	let previous;
	beforeEach(() => { previous = Config.copaRinhaSingleFormat; Config.copaRinhaSingleFormat = true; });
	afterEach(() => {
		Config.copaRinhaSingleFormat = previous;
		Rooms.global.formatList = '';
	});
	it('preserves the canonical ID, resolves the new display name and retains official formats internally', () => {
		const format = Dex.formats.get(COPA_FORMAT);
		assert.equal(format.name, 'Copa Rinha II'); assert.equal(format.id, COPA_FORMAT);
		assert.equal(Dex.formats.get('Copa Rinha II').id, COPA_FORMAT);
		assert.equal(Dex.formats.get('[Gen 9] [Copa Rinha] National Dex ZA').id, COPA_FORMAT);
		assert.equal(format.mod, 'coparinha');
		assert(Dex.formats.get('gen9ou').exists); assert(Dex.formats.all().length > 100);
		assert(playerFormatAllowed(COPA_FORMAT)); assert(playerFormatAllowed('Copa Rinha II'));
	});
	it('advertises only Copa Rinha II with search and challenge available', () => {
		Rooms.global.formatList = '';
		const formats = Rooms.global.formatListText;
		assert(formats.includes('|[Gen 9] Copa Rinha II,e'));
		assert(!formats.includes('Random Battle')); assert(!formats.includes('[Gen 9] OU'));
	});
	for (const format of ['gen9ou', 'gen9randombattle', 'gen9customgame', 'unknowncustom', COPA_FORMAT + '@@@+Pikachu']) {
		it(`rejects ${format} in preparation of search/challenge/tour and central player battle creation`, async () => {
			assert.equal(playerFormatAllowed(format), false);
			for (const type of ['search', 'challenge', 'tour']) {
				const messages = [];
				const connection = { user: { id: 'test', battleSettings: { team: '' } }, popup: msg => messages.push(msg) };
				assert.equal(await Ladders(format).prepBattle(connection, type), null);
				assert.deepEqual(messages, [COPA_ONLY_MESSAGE]);
			}
			const messages = [];
			assert.equal(Rooms.createBattle({ format, players: [{ user: { popup: msg => messages.push(msg) } }] }), null);
			assert.deepEqual(messages, [COPA_ONLY_MESSAGE]);
		});
	}
	it('prepares a valid native Copa team for both search and challenge', async () => {
		const user = makeUser('Copa Policy Ready', '192.0.2.123');
		try {
			const team = require('../../dist/sim/teams').Teams.pack([
				{ species: 'Pikachu', ability: 'Static', moves: ['Thunderbolt'], evs: { hp: 1 } },
			]);
			for (const type of ['search', 'challenge']) {
				const messages = [];
				user.connections[0].popup = msg => messages.push(msg);
				const ready = await Ladders('gen9coparinhaii').prepBattle(user.connections[0], type, team);
				assert(ready, messages.join('\n')); assert.equal(ready.formatid, COPA_FORMAT);
			}
		} finally { user.disconnectAll(); user.destroy(); }
	});
	it('allows a native Copa challenge battle and leaves non-Copa local tests unrestricted when disabled', () => {
		const p1 = makeUser('Copa Policy One'); const p2 = makeUser('Copa Policy Two');
		let room;
		try {
			room = Rooms.createBattle({ format: '[Gen 9] Copa Rinha II', players: [p1, p2].map(user => ({ user, team: 'Pikachu||||thunderbolt||||||||' })) });
			assert(room?.battle); assert.equal(room.battle.format, COPA_FORMAT);
		} finally {
			room?.destroy();
			for (const user of [p1, p2]) { user.disconnectAll(); user.destroy(); }
		}
		Config.copaRinhaSingleFormat = false;
		assert(playerFormatAllowed('gen9ou'));
	});
});
