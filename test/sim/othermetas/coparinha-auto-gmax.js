'use strict';
const assert = require('assert').strict;
const common = require('../../common');
const { TeamValidator, Teams, Dex } = require('../../../dist/sim');
const { TeamValidatorAsync } = require('../../../dist/server/team-validator-async');
const formatid = 'gen9coparinhanationaldexza';
const alias = 'gen9coparinhaii';
function set(species, options = {}) {
	return { species, ability: Dex.mod('coparinha').species.get(species).abilities['0'],
		moves: ['Tackle'], evs: { hp: 1 }, teraType: 'Water', ...options };
}
function validated(team, format = formatid) {
	const parsed = Teams.unpack(Teams.pack(team));
	assert.equal(new TeamValidator(format).validateTeam(parsed), null);
	return Teams.unpack(Teams.pack(parsed));
}
describe('Copa Rinha automatic Gigantamax', () => {
	let battle;
	afterEach(() => { battle?.destroy(); battle = null; });
	function start(team) {
		battle = common.createBattle({ formatid }, [team, [
			{ species: 'Blissey', ability: 'Natural Cure', moves: ['Splash'], evs: { hp: 252 } },
		]]);
		battle.makeChoices('team 123456', 'team 1');
		return battle.p1.active[0];
	}
	it('takes a flag-free official-client packed team through async validation into the real G-Max request and move', async () => {
		const input = set('Pikachu', { item: 'Pikanium Z', moves: ['Volt Tackle'] });
		assert(!Object.hasOwn(input, 'gigantamax'));
		const packed = Teams.pack([input]);
		assert.equal(Teams.unpack(packed)[0].gigantamax, false);
		const result = await TeamValidatorAsync.get(alias).validateTeam(packed);
		assert.equal(result[0], '1', result);
		const normalized = Teams.unpack(result.slice(1));
		assert.equal(normalized[0].gigantamax, true); assert.equal(normalized[0].teraType, 'Water');
		const pokemon = start(normalized);
		assert.equal(pokemon.gigantamax, true); assert.equal(pokemon.set.gigantamax, true);
		const request = battle.p1.activeRequest.active[0];
		assert(request.canDynamax); assert(request.canZMove); assert.equal(request.canTerastallize, 'Water');
		assert.equal(request.maxMoves.gigantamax, 'G-Max Volt Crash');
		assert.equal(request.maxMoves.maxMoves[0].move, 'gmaxvoltcrash');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(pokemon.volatiles.dynamax);
		assert(battle.log.some(line => line.includes('|Dynamax|Gmax')));
		assert(battle.log.some(line => line.includes('G-Max Volt Crash')));
	});
	it('automatically enables Charizard with a Mega Stone while preserving Mega and Tera choices', () => {
		const team = validated([set('Charizard', { item: 'Charizardite X', moves: ['Flamethrower'] })]);
		const pokemon = start(team);
		const request = battle.p1.activeRequest.active[0];
		assert(request.canMegaEvo); assert(request.canDynamax); assert.equal(request.canTerastallize, 'Water');
		assert.equal(request.maxMoves.gigantamax, 'G-Max Wildfire');
		assert.equal(request.maxMoves.maxMoves[0].move, 'gmaxwildfire');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(pokemon.volatiles.dynamax);
		assert(battle.log.some(line => line.includes('|Dynamax|Gmax')));
		assert(battle.log.some(line => line.includes('G-Max Wildfire')));
	});
	it('leaves Zapdos on normal Dynamax with no G-Max data', () => {
		const team = validated([set('Zapdos', { moves: ['Thunderbolt'] })]);
		assert(!team[0].gigantamax);
		const pokemon = start(team);
		const request = battle.p1.activeRequest.active[0];
		assert(request.canDynamax); assert.equal(request.maxMoves.gigantamax, undefined);
		assert.equal(request.maxMoves.maxMoves[0].move, 'maxlightning');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(pokemon.volatiles.dynamax); assert.equal(pokemon.species.name, 'Zapdos');
	});
	it('resolves alternate-form eligibility from the Dex without granting G-Max to cap or regional forms', () => {
		for (const [species, move, expected] of [
			['Toxtricity-Low-Key', 'Thunderbolt', 'G-Max Stun Shock'],
			['Urshifu-Rapid-Strike', 'Surging Strikes', 'G-Max Rapid Flow'],
			['Pikachu-Original', 'Thunderbolt', null],
			['Meowth-Alola', 'Bite', null],
		]) {
			const team = validated([set(species, { moves: [move] })]);
			assert.equal(!!team[0].gigantamax, !!expected, species);
			const pokemon = start(team);
			assert.equal(pokemon.getDynamaxRequest().gigantamax || null, expected, species);
			battle.destroy(); battle = null;
		}
	});
	it('retains explicit Yes and automatically overrides explicit No for eligible species only in Copa', () => {
		for (const flag of [true, false]) {
			assert.equal(validated([set('Pikachu', { gigantamax: flag, moves: ['Thunderbolt'] })])[0].gigantamax, true);
		}
		const team = validated([set('Pikachu', { moves: ['Thunderbolt'] })], 'gen9nationaldexag');
		assert(!team[0].gigantamax);
		assert(new TeamValidator(formatid).validateTeam([set('Zapdos', { gigantamax: true, moves: ['Thunderbolt'] })]));
	});
	for (const mechanic of ['dynamax', 'zmove', 'terastallize']) {
		it(`auto-G-Max coexists with Z/Tera before choosing ${mechanic}, then enforces per-Pokemon exclusivity`, () => {
			const team = validated([
				set('Pikachu', { item: 'Pikanium Z', moves: ['Volt Tackle'] }),
				set('Charizard', { item: 'Charizardite X', moves: ['Flamethrower'] }),
				set('Mew', { item: 'Psychium Z', moves: ['Psychic'] }),
				set('Garchomp', { moves: ['Dragon Claw'] }),
			]);
			const pokemon = start(team);
			const before = pokemon.getMoveRequestData();
			assert(before.canZMove); assert(before.canDynamax); assert.equal(before.maxMoves.gigantamax, 'G-Max Volt Crash');
			assert.equal(before.canTerastallize, 'Water');
			battle.makeChoices(`move 1 ${mechanic}`, 'auto');
			if (mechanic === 'dynamax') { battle.makeChoices(); battle.makeChoices(); }
			const after = pokemon.getMoveRequestData();
			assert(!after.canZMove); assert(!after.canDynamax);
			assert(!after.canTerastallize); assert(!after.canMegaEvo);
			assert.equal(battle.p1.dynamaxUsed, mechanic === 'dynamax');
			assert.equal(battle.p1.zMoveUsed, mechanic === 'zmove');
			assert.equal(!!pokemon.terastallized, mechanic === 'terastallize');
			assert.equal(!!battle.p1.pokemon[1].getDynamaxRequest(), mechanic !== 'dynamax');
			assert.equal(!!battle.actions.canZMove(battle.p1.pokemon[2]), mechanic !== 'zmove');
			assert.equal(!!battle.p1.pokemon[3].canTerastallize, mechanic !== 'terastallize');
			assert(battle.p1.pokemon[1].canMegaEvo);
		});
	}
	it('Mega on an auto-G-Max Charizard blocks its other choices but keeps team Dynamax, Z and Tera unused', () => {
		const pokemon = start(validated([set('Charizard', { item: 'Charizardite X', moves: ['Flamethrower'] })]));
		battle.makeChoices('move 1 mega', 'auto');
		assert.equal(pokemon.species.name, 'Charizard-Mega-X');
		const request = pokemon.getMoveRequestData();
		assert(!request.canDynamax); assert(!request.canZMove); assert(!request.canTerastallize);
		assert(!battle.p1.dynamaxUsed); assert(!battle.p1.zMoveUsed); assert(!pokemon.terastallized);
	});
});
