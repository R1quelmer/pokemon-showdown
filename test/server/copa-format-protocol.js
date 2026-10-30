'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BattleReady, BattleChallenge, Challenges } = require('../../dist/server/ladders-challenges');
const { Ladders } = require('../../dist/server/ladders');
const { COPA_FORMAT, playerFormatAllowed } = require('../../dist/server/copa-format-policy');
const wire = 'gen9coparinhaii';
function stockParser(client, packet) {
	let source = fs.readFileSync(path.join(__dirname, 'fixtures/official-formats', `${client}-client.txt`), 'utf8');
	if (client === 'new') {
		source = source.replace('parseFormats(formatsList: string[])', 'function (formatsList)')
			.replace("let team: 'preset' | null", 'let team').replace('let teambuilderLevel: number | null', 'let teambuilderLevel')
			.replace("'' as ID", "''").replace('let multivariantFormats: { [id: string]: 1 }', 'let multivariantFormats')
			.replace('.teambuilderFormat!', '.teambuilderFormat');
	} else {
		source = source.trim().replace(/^parseFormats: /, '').replace(/,$/, '');
	}
	const context = { PS: { teams: { update() {} } }, app: { supports: {} },
		toID: value => value.toLowerCase().replace(/[^a-z0-9]/g, ''), Dex: { formats: { load: data => data } },
		$: { trim: value => value.trim() } };
	context.window = context;
	context.Dex.gen = 9;
	const constructor = fs.readFileSync(path.join(__dirname, 'fixtures/official-formats/format-constructor.txt'), 'utf8')
		.replace('constructor(name: string, data?: FormatData)', 'function OfficialBattleFormat(name, data)')
		.replace(/ as ID/g, '');
	vm.runInNewContext(`${constructor}; Dex.formats.load = data => {
		const result = {}; for (const id in data) result[id] = new OfficialBattleFormat(data[id].name, data[id]);
		return result;
	};`, context);
	vm.runInNewContext(`(${source}).call({trigger() {}}, ${JSON.stringify(packet.slice(1).split('|'))});`, context);
	return context.BattleFormats;
}
describe('Stock psim.us formats protocol compatibility', () => {
	let previous;
	beforeEach(() => {
		previous = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		Rooms.global.formatList = '';
	});
	afterEach(() => { Config.copaRinhaSingleFormat = previous; Rooms.global.formatList = ''; });
	for (const client of ['old', 'new']) {
		it(`${client} stock parser reproduces the previous Gen 6 synthetic entry and parses the fixed single Gen 9 entry`, () => {
			const broken = stockParser(client, '|formats|,1|Copa Rinha|Copa Rinha II,e');
			assert.deepEqual(Object.keys(broken), ['gen6coparinhaii', 'coparinhaii']);
			const formats = stockParser(client, Rooms.global.formatListText);
			assert.deepEqual(Object.keys(formats), [wire]);
			const format = formats[wire];
			assert.equal(format.name, '[Gen 9] Copa Rinha II'); assert.equal(format.section, 'Copa Rinha');
			assert.equal(format.column, 1);
			assert(format.searchShow); assert(format.challengeShow); assert(format.tournamentShow);
			assert(format.isTeambuilderFormat); assert.equal(format.teambuilderFormat, '');
			assert.equal(format.gen, 9); assert.equal(format.id.slice(0, 4), 'gen9'); assert.equal(format.team, null);
		});
	}
	it('accepts stock-client aliases in validator, Search/Challenge/cancel and canonicalizes player battles', () => {
		assert.equal(Dex.formats.get(wire).id, COPA_FORMAT);
		assert.equal(Dex.formats.validate('[Gen 9] Copa Rinha II'), COPA_FORMAT);
		assert.equal(Ladders(wire).formatid, COPA_FORMAT);
		assert(playerFormatAllowed(wire)); assert(!playerFormatAllowed(wire + '@@@+Pikachu'));
		const { TeamValidator } = require('../../dist/sim/team-validator');
		const team = [{ species: 'Pikachu', ability: 'Static', moves: ['Thunderbolt'], evs: { hp: 1 } }];
		assert.equal(new TeamValidator(wire).validateTeam(team), null);
		assert.equal(Dex.mod(Dex.formats.get(wire).mod).gen, 9);
	});
	it('emits a Gen 9 tier for playback while preserving canonical simulator identity', () => {
		const { Battle } = require('../../dist/sim/battle');
		const team = [{ species: 'Pikachu', ability: 'Static', moves: ['Thunderbolt'] }];
		const battle = new Battle({ formatid: wire, p1: { name: 'Alice', team }, p2: { name: 'Bob', team } });
		try {
			assert.equal(battle.format.id, COPA_FORMAT); assert.equal(battle.format.name, 'Copa Rinha II');
			assert.equal(battle.gen, 9);
			assert(battle.log.includes('|tier|[Gen 9] Copa Rinha II'));
		} finally { battle.destroy(); }
	});
	it('uses the advertised alias only in outgoing search and challenge packets', () => {
		const ready = new BattleReady('alice', COPA_FORMAT, {});
		const challenge = new BattleChallenge('alice', 'bob', ready);
		const update = new Challenges().getUpdate(challenge);
		assert(update.startsWith(`/challenge ${wire}|${wire}|`)); assert.equal(ready.formatid, COPA_FORMAT);
		Ladders.searches.set(COPA_FORMAT, { searches: new Map([['alice', ready]]) });
		let packet;
		try {
			const user = { id: 'alice', games: new Set(), send: text => { packet = text; } };
			Ladders.updateSearch(user);
			assert.deepEqual(JSON.parse(packet.slice('|updatesearch|'.length)).searching, [wire]);
			assert.deepEqual(Ladders.getSearches({ id: 'alice' }), [COPA_FORMAT]);
			assert(Ladders(wire).hasSearch(user));
			assert(Ladders(wire).cancelSearch(user));
			assert.deepEqual(JSON.parse(packet.slice('|updatesearch|'.length)).searching, []);
		} finally { Ladders.searches.delete(COPA_FORMAT); }
	});
});
