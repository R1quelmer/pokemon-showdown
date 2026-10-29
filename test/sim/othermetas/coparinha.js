'use strict';

const assert = require('../../assert');
const common = require('../../common');
const { TeamValidator, Dex } = require('../../../dist/sim');

describe('Copa Rinha National Dex ZA', () => {
	let battle;
	const formatid = 'gen9coparinhanationaldexza';
	const charizard = { species: 'Charizard', item: 'charizarditex', moves: ['sleeptalk'], teraType: 'Water' };
	const mew = { species: 'Mew', item: 'normaliumz', moves: ['splash'], teraType: 'Water' };
	const venusaur = { species: 'Venusaur', item: 'venusaurite', moves: ['sleeptalk'], teraType: 'Water' };
	function create(team) {
		battle = common.createBattle({ formatid }, [team, [
			{ species: 'Blissey', ability: 'naturalcure', moves: ['splash'] },
		]]);
		battle.makeChoices('team 123456', 'team 1');
		return battle.p1.active[0];
	}
	function noOptions(pokemon) {
		const request = pokemon.getMoveRequestData();
		assert(!request.canMegaEvo);
		assert(!request.canZMove);
		assert(!request.canDynamax);
		assert(!request.canTerastallize);
	}
	afterEach(() => {
		battle?.destroy();
		battle = null;
	});

	it('advertises a canonical Gen 9 ID while retaining the Copa Rinha mod and rules', () => {
		const format = Dex.formats.get(formatid);
		assert.equal(format.id, formatid);
		assert.equal(format.name, '[Gen 9] [Copa Rinha] National Dex ZA');
		assert.equal(format.mod, 'coparinha');
		assert.equal(Dex.mod(format.mod).gen, 9);
		assert.deepEqual(format.ruleset, ['Standard AG', 'NatDex Mod', 'Copa Rinha Mechanics']);
	});

	it('validates the editor test team with past Pokemon, Gen 8 and Gen 9 species', () => {
		const validator = new TeamValidator(formatid);
		assert.equal(validator.validateTeam([
			{ species: 'Lucario', ability: 'Inner Focus', item: 'Lucarionite', moves: ['Aura Sphere'], evs: { hp: 252 } },
			{ species: 'Greninja', ability: 'Torrent', moves: ['Surf'], evs: { hp: 252 } },
			{ species: 'Venusaur', ability: 'Overgrow', item: 'Venusaurite', moves: ['Giga Drain'], evs: { hp: 252 } },
			{ species: 'Pikachu', ability: 'Static', item: 'Pikanium Z', gigantamax: true, moves: ['Volt Tackle'], evs: { hp: 252 } },
			{ species: 'Dragapult', ability: 'Clear Body', moves: ['Shadow Ball'], evs: { hp: 252 } },
			{ species: 'Miraidon', ability: 'Hadron Engine', moves: ['Electro Drift'], evs: { hp: 252 } },
		]), null);
	});

	it('offers Mega, Dynamax and Tera together with a Mega Stone', () => {
		const pokemon = create([charizard]);
		const request = pokemon.getMoveRequestData();
		assert(request.canMegaEvo);
		assert(request.canDynamax);
		assert.equal(request.canTerastallize, 'Water');
	});

	it('sends Venusaurite Mega, Dynamax and Tera options in the same active request', () => {
		create([venusaur]);
		const request = battle.p1.activeRequest.active[0];
		assert(request.canMegaEvo);
		assert(request.canDynamax);
		assert.equal(request.canTerastallize, 'Water');
		assert(request.maxMoves.maxMoves.length);
	});

	it('Venusaur Dynamax blocks its own Mega and Tera but leaves Lucario Mega and team Tera usable', () => {
		const pokemon = create([venusaur, { species: 'Lucario', item: 'lucarionite', moves: ['sleeptalk'] },
			{ species: 'Garchomp', moves: ['sleeptalk'], teraType: 'Water' }]);
		const lucario = battle.p1.pokemon[1];
		const garchomp = battle.p1.pokemon[2];
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(pokemon.volatiles.dynamax);
		noOptions(pokemon);
		assert(lucario.canMegaEvo);
		assert(garchomp.canTerastallize);
		battle.makeChoices();
		battle.makeChoices();
		assert(!pokemon.volatiles.dynamax);
		for (const flag of ['mega', 'terastallize']) {
			assert.throws(() => battle.makeChoices(`move 1 ${flag}`, 'auto'), /Invalid choice/);
		}
		battle.makeChoices('switch 2', 'auto');
		battle.makeChoices('move 1 mega', 'auto');
		assert.species(lucario, 'Lucario-Mega');
		battle.makeChoices('switch 3', 'auto');
		battle.makeChoices('move 1 terastallize', 'auto');
		assert.equal(garchomp.terastallized, 'Water');
	});

	it('offers Z-Move, Dynamax and Tera together with a Z-Crystal', () => {
		const pokemon = create([mew]);
		const request = pokemon.getMoveRequestData();
		assert(request.canZMove[0]);
		assert(request.canDynamax);
		assert.equal(request.canTerastallize, 'Water');
	});

	/** @type {[string, typeof charizard | typeof mew, string][]} */
	const cases = [
		['mega', charizard, 'mega'],
		['zmove', mew, 'zmove'],
		['dynamax', charizard, 'dynamax'],
		['dynamax', mew, 'dynamax'],
		['tera', charizard, 'terastallize'],
		['tera', mew, 'terastallize'],
	];
	for (const [mechanic, set, choice] of cases) {
		it(`locks other mechanics after ${mechanic} with ${set.item}, including after switching`, () => {
			const pokemon = create([set, { species: 'Magikarp', moves: ['splash'] }]);
			battle.makeChoices(`move 1 ${choice}`, 'auto');
			assert.equal(pokemon.m.copaRinhaMechanic, mechanic);
			if (mechanic === 'mega') assert.equal(pokemon.species.name, 'Charizard-Mega-X');
			if (mechanic === 'zmove') assert(battle.p1.zMoveUsed);
			if (mechanic === 'tera') assert.equal(pokemon.terastallized, 'Water');
			if (mechanic === 'dynamax') {
				assert(pokemon.volatiles.dynamax);
				battle.makeChoices();
				battle.makeChoices();
				assert(!pokemon.volatiles.dynamax);
			}
			noOptions(pokemon);
			battle.makeChoices('switch 2', 'auto');
			battle.makeChoices('switch 2', 'auto');
			noOptions(pokemon);
			assert.throws(() => battle.makeChoices(`move 1 ${mechanic === 'tera' ? 'dynamax' : 'terastallize'}`, 'auto'));
		});
	}

	it('uses all four allowances on separate Pokemon in the same battle, only once each', () => {
		const team = [charizard, mew, { species: 'Magikarp', moves: ['splash'] },
			{ species: 'Eevee', moves: ['splash'] }, { ...charizard }, { ...mew }];
		create(team);
		const pokemon = battle.p1.pokemon.slice();
		battle.makeChoices('move 1 mega', 'auto');
		assert(!battle.p1.pokemon[4].canMegaEvo);
		assert(battle.p1.pokemon[1].getMoveRequestData().canZMove);
		battle.makeChoices('switch 2', 'auto');
		battle.makeChoices('move 1 zmove', 'auto');
		assert(!battle.actions.canZMove(pokemon[5]));
		battle.makeChoices('switch 3', 'auto');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(!battle.p1.canDynamaxNow());
		battle.makeChoices('switch 4', 'auto');
		battle.makeChoices('move 1 terastallize', 'auto');
		assert(battle.p1.pokemon.every(pokemon => !pokemon.canTerastallize));
		assert.deepEqual(pokemon.slice(0, 4).map(pokemon => pokemon.m.copaRinhaMechanic),
			['mega', 'zmove', 'dynamax', 'tera']);
	});

	/** @type {[string, typeof charizard | typeof mew, string][]} */
	const allowanceCases = [
		['mega', charizard, 'canMegaEvo'],
		['zmove', mew, 'canZMove'],
		['dynamax', venusaur, 'canDynamax'],
		['terastallize', mew, 'canTerastallize'],
	];
	for (const [flag, set, requestField] of allowanceCases) {
		it(`rejects a second ${flag} by a different unused Pokemon on the same team`, () => {
			create([{ ...set }, { ...set }]);
			const teammate = battle.p1.pokemon[1];
			battle.makeChoices(`move 1 ${flag}`, 'auto');
			battle.makeChoices('switch 2', 'auto');
			assert.equal(battle.p1.active[0], teammate);
			assert(!teammate.m.copaRinhaMechanic);
			assert(!battle.p1.activeRequest.active[0][requestField]);
			const turn = battle.turn;
			assert.throws(() => battle.makeChoices(`move 1 ${flag}`, 'auto'), /Invalid choice/);
			assert.equal(battle.turn, turn);
			assert(!teammate.m.copaRinhaMechanic);
		});
	}

	for (const gmaxFirst of [false, true]) {
		it(`shares the Dynamax/Gigantamax allowance when ${gmaxFirst ? 'Gigantamax' : 'Dynamax'} is used first`, () => {
			const gmax = { species: 'Pikachu', item: 'electriumz', gigantamax: true, moves: ['thunderbolt'] };
			create(gmaxFirst ? [gmax, venusaur] : [venusaur, gmax]);
			battle.makeChoices('move 1 dynamax', 'auto');
			assert(battle.p1.dynamaxUsed);
			battle.makeChoices('switch 2', 'auto');
			assert(!battle.p1.activeRequest.active[0].canDynamax);
			assert.throws(() => battle.makeChoices('move 1 dynamax', 'auto'), /Invalid choice/);
		});
	}

	it('executes a G-Max Move while holding a Z-Crystal', () => {
		const pokemon = create([{
			species: 'Charizard', item: 'firiumz', gigantamax: true, moves: ['ember'],
		}]);
		assert.equal(pokemon.getMoveRequestData().maxMoves.maxMoves[0].move, 'gmaxwildfire');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(pokemon.volatiles.dynamax);
		assert(battle.log.some(line => line.includes('G-Max Wildfire')));
		assert.equal(pokemon.m.copaRinhaMechanic, 'dynamax');
	});

	it('runs Venusaur Dynamax, Lucario Mega, Pikachu Z and Garchomp Tera for both players', () => {
		const team = [
			{ species: 'Venusaur', item: 'venusaurite', moves: ['sleeptalk'] },
			{ species: 'Lucario', item: 'lucarionite', moves: ['sleeptalk'] },
			{ species: 'Pikachu', item: 'pikaniumz', gigantamax: true, moves: ['volttackle'] },
			{ species: 'Garchomp', moves: ['sleeptalk'], teraType: 'Water' },
		];
		battle = common.createBattle({ formatid }, [team, team]);
		battle.makeChoices('team 1234', 'team 1234');
		const teams = battle.sides.map(side => side.pokemon.slice());
		const both = choice => battle.makeChoices(choice, choice);
		both('move 1 dynamax');
		for (const side of battle.sides) assert(side.pokemon[1].canMegaEvo);
		both('switch 2');
		both('move 1 mega');
		for (const side of battle.sides) assert.equal(side.active[0].species.name, 'Lucario-Mega');
		both('switch 3');
		both('move 1 zmove');
		both('switch 4');
		both('move 1 terastallize');
		for (const pokemon of teams) {
			assert.deepEqual(pokemon.map(mon => mon.m.copaRinhaMechanic), ['dynamax', 'mega', 'zmove', 'tera']);
		}
	});

	it('Pikachu G-Max preserves the team Z and Tera allowances', () => {
		const pikachu = create([
			{ species: 'Pikachu', item: 'pikaniumz', gigantamax: true, moves: ['thunderbolt', 'volttackle'] }, mew,
			{ species: 'Garchomp', moves: ['sleeptalk'], teraType: 'Water' },
		]);
		const teammate = battle.p1.pokemon[1];
		const teraUser = battle.p1.pokemon[2];
		const request = battle.p1.activeRequest.active[0];
		assert(request.canZMove[1]);
		assert(request.canDynamax);
		assert(request.canTerastallize);
		assert.equal(request.maxMoves.gigantamax, 'G-Max Volt Crash');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(battle.log.some(line => line.includes('G-Max Volt Crash')));
		noOptions(pikachu);
		assert(!battle.p1.zMoveUsed);
		assert(battle.actions.canZMove(teammate));
		assert(teammate.canTerastallize);
		battle.makeChoices();
		battle.makeChoices();
		assert(!pikachu.volatiles.dynamax);
		assert.throws(() => battle.makeChoices('move 2 zmove', 'auto'), /Invalid choice/);
		assert.throws(() => battle.makeChoices('move 1 terastallize', 'auto'), /Invalid choice/);
		battle.makeChoices('switch 2', 'auto');
		battle.makeChoices('move 1 zmove', 'auto');
		assert.equal(teammate.m.copaRinhaMechanic, 'zmove');
		battle.makeChoices('switch 2', 'auto');
		assert.equal(battle.p1.active[0], pikachu);
		noOptions(pikachu);
		assert.throws(() => battle.makeChoices('move 2 zmove', 'auto'), /Invalid choice/);
		assert.throws(() => battle.makeChoices('move 1 terastallize', 'auto'), /Invalid choice/);
		battle.makeChoices('switch 3', 'auto');
		battle.makeChoices('move 1 terastallize', 'auto');
		assert.equal(teraUser.terastallized, 'Water');
	});

	it('rejects multiple mechanic flags for a single action', () => {
		create([charizard]);
		for (const flags of ['mega dynamax', 'mega terastallize', 'dynamax terastallize']) {
			assert.throws(() => battle.makeChoices(`move 1 ${flags}`, 'auto'), /Conflicting arguments/);
		}
		assert(!battle.p1.active[0].m.copaRinhaMechanic);
	});

	it('does not consume Z-Move or Pokemon allowance when asleep before activation', () => {
		const pokemon = create([mew]);
		pokemon.setStatus('slp');
		pokemon.statusState.time = 3;
		battle.makeChoices('move 1 zmove', 'auto');
		assert(!battle.p1.zMoveUsed);
		assert(!pokemon.m.copaRinhaMechanic);
		assert(pokemon.getMoveRequestData().canTerastallize);
	});

	it('allows Uber and past Pokemon without tier bans, but validates normal set legality', () => {
		const validator = new TeamValidator(formatid);
		assert.equal(validator.validateTeam([
			{ species: 'Arceus', ability: 'Multitype', moves: ['Judgment'], evs: { hp: 252 } },
			{ species: 'Darkrai', ability: 'Bad Dreams', moves: ['Dark Pulse'], evs: { hp: 252 } },
			{ species: 'Charizard', ability: 'Blaze', item: 'Charizardite X', moves: ['Flamethrower'], gigantamax: true, evs: { hp: 252 } },
		]), null);
		const illegalMove = validator.validateTeam([
			{ species: 'Magikarp', ability: 'Swift Swim', moves: ['Judgment'], evs: { hp: 252 } },
		]);
		assert(illegalMove?.some(problem => problem.includes("can't learn Judgment")));
	});

	it('allows implemented ZA Mega Stones while preserving ordinary move legality', () => {
		const validator = new TeamValidator(formatid);
		const clefable = { species: 'Clefable', ability: 'Magic Guard', moves: ['Moonblast'], evs: { hp: 252 } };
		assert.equal(validator.validateTeam([{ ...clefable }]), null);
		assert.equal(validator.validateTeam([{ ...clefable, item: 'Clefablite' }]), null);
		assert(validator.validateTeam([{ ...clefable, item: 'Clefablite', moves: ['Judgment'] }])?.length);
	});

	it('leaves official National Dex mechanics unchanged', () => {
		battle = common.createBattle({ formatid: 'gen9nationaldexag' }, [[charizard], [mew]]);
		battle.makeChoices('team 1', 'team 1');
		const request = battle.p1.active[0].getMoveRequestData();
		assert(request.canMegaEvo);
		assert(!request.canDynamax);
		assert(!request.canTerastallize);
		assert.equal(Dex.formats.get('gen9nationaldexag').mod, 'gen9');
		assert(!Dex.mod('gen9').species.get('Charizard-Mega-X').canGigantamax);
		assert(!Dex.mod('gen9').species.get('Venusaur-Mega').canGigantamax);
	});
});
