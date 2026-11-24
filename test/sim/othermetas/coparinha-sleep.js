'use strict';

const assert = require('../../assert');
const common = require('../../common');
const { Dex, TeamValidator } = require('../../../dist/sim');

// Exercise the actual public format, including its normal preview and mod.
// No local sleep implementation, custom rules or client-specific conditions.
describe('Copa Rinha II native Sleep Clause Mod', () => {
	let battle;
	const formatid = 'gen9coparinhanationaldexza';
	const sleeper = { species: 'Smeargle', ability: 'owntempo', moves: ['spore', 'yawn', 'splash', 'fissure'] };
	function create(p1 = [sleeper], p2 = [
		{ species: 'Blissey', ability: 'serenegrace', moves: ['splash'] },
		{ species: 'Chansey', ability: 'healer', moves: ['splash'] },
	]) {
		battle = common.createBattle({ formatid, forceRandomChance: true }, [p1, p2]);
		battle.makeChoices(`team ${p1.map((p, i) => i + 1).join('')}`, `team ${p2.map((p, i) => i + 1).join('')}`);
		return battle;
	}
	afterEach(() => {
		battle?.destroy();
		battle = null;
	});

	it('enables only the native clause on the canonical format and its official wire alias', () => {
		for (const id of [formatid, 'gen9coparinhaii']) {
			const format = Dex.formats.get(id);
			assert.equal(format.id, formatid);
			const rules = Dex.formats.getRuleTable(format);
			assert(rules.has('sleepclausemod'));
			assert(!rules.has('sleepmovesclause'));
			assert(!rules.has('dynamaxclause'));
			assert(!rules.has('terastalclause'));
		}
		assert(!Dex.formats.getRuleTable(Dex.formats.get('gen9nationaldexag')).has('sleepclausemod'));
	});

	it('continues validating legal sleep-inducing moves rather than banning them', () => {
		assert.equal(TeamValidator.get(formatid).validateTeam([
			{ species: 'Amoonguss', ability: 'Regenerator', moves: ['Spore'], evs: { hp: 252 } },
			{ species: 'Venusaur', ability: 'Overgrow', moves: ['Sleep Powder'], evs: { hp: 252 } },
			{ species: 'Hypno', ability: 'Insomnia', moves: ['Hypnosis'], evs: { hp: 252 } },
			{ species: 'Jynx', ability: 'Forewarn', moves: ['Lovely Kiss'], evs: { hp: 252 } },
			{ species: 'Snorlax', ability: 'Thick Fat', moves: ['Yawn', 'Rest'], evs: { hp: 252 } },
		]), null);
	});

	for (const move of ['spore', 'hypnosis', 'sleeppowder', 'lovelykiss', 'sing']) {
		it(`allows the first ${move}, but blocks a second enemy-induced sleep while the first sleeps on the bench`, () => {
			create([{ species: 'Smeargle', moves: [move] }]);
			battle.makeChoices('move 1', 'move 1');
			const first = battle.p2.active[0];
			assert.equal(first.status, 'slp');
			battle.makeChoices('move 1', 'switch 2');
			assert.equal(first.status, 'slp');
			assert.equal(battle.p2.active[0].status, '');
			assert(battle.log.some(line => line.includes('Sleep Clause Mod activated.')));
		});
	}

	it('releases the limit when the induced sleeper wakes through the native sleep condition', () => {
		create();
		battle.makeChoices('move spore', 'move splash');
		const first = battle.p2.active[0];
		battle.makeChoices('move spore', 'switch 2');
		assert.equal(battle.p2.active[0].status, '');
		// Fix only the remaining native sleep duration, then let a real turn wake it.
		first.statusState.time = 1;
		battle.makeChoices('move splash', 'switch 2');
		battle.makeChoices('move splash', 'move splash');
		assert.equal(first.status, '');
		battle.makeChoices('move spore', 'switch 2');
		assert.equal(battle.p2.active[0].status, 'slp');
	});

	it('releases the limit when the sleeping Pokemon faints', () => {
		create();
		battle.makeChoices('move spore', 'move splash');
		const first = battle.p2.active[0];
		battle.makeChoices('move fissure', 'move splash');
		assert.fainted(first);
		battle.makeChoices('', 'switch 2');
		battle.makeChoices('move spore', 'move splash');
		assert.equal(battle.p2.active[0].status, 'slp');
	});

	it('does not count an earlier Rest against enemy-induced sleep', () => {
		create([{ species: 'Smeargle', moves: ['tackle', 'spore', 'splash'] }], [
			{ species: 'Blissey', ability: 'serenegrace', moves: ['rest'] },
			{ species: 'Chansey', ability: 'healer', moves: ['splash'] },
		]);
		battle.makeChoices('move tackle', 'move rest');
		const resting = battle.p2.active[0];
		assert.equal(resting.status, 'slp');
		assert.equal(resting.statusState.source, resting);
		battle.makeChoices('move spore', 'switch 2');
		assert.equal(resting.status, 'slp');
		assert.equal(battle.p2.active[0].status, 'slp');
	});

	it('allows Rest even while an ally is already sleeping from an enemy move', () => {
		create([{ species: 'Smeargle', moves: ['spore', 'tackle'] }], [
			{ species: 'Blissey', ability: 'serenegrace', moves: ['splash'] },
			{ species: 'Chansey', ability: 'healer', moves: ['rest'] },
		]);
		battle.makeChoices('move spore', 'move splash');
		const first = battle.p2.active[0];
		battle.makeChoices('move tackle', 'switch 2');
		battle.makeChoices('move tackle', 'move rest');
		assert.equal(first.status, 'slp');
		assert.equal(battle.p2.active[0].status, 'slp');
	});

	it('blocks Yawn at delayed status application while the first induced sleeper remains asleep', () => {
		create();
		battle.makeChoices('move spore', 'move splash');
		battle.makeChoices('move yawn', 'switch 2');
		assert(battle.p2.active[0].volatiles.yawn);
		battle.makeChoices('move splash', 'move splash');
		assert.equal(battle.p2.pokemon[1].status, 'slp');
		assert.equal(battle.p2.active[0].status, '');
		assert(!battle.p2.active[0].volatiles.yawn);
	});

	it('applies the same native limit to sleep caused by Effect Spore', () => {
		create([{ species: 'Parasect', ability: 'effectspore', moves: ['splash'] }], [
			{ species: 'Blissey', ability: 'serenegrace', moves: ['pound'] },
			{ species: 'Chansey', ability: 'healer', moves: ['pound'] },
		]);
		// Select Effect Spore's sleep branch, without replacing the ability or status engine.
		battle.random = (from, to) => to === undefined ? 0 : from;
		battle.makeChoices('move splash', 'move pound');
		const first = battle.p2.active[0];
		assert.equal(first.status, 'slp');
		battle.makeChoices('move splash', 'switch 2');
		battle.makeChoices('move splash', 'move pound');
		assert.equal(first.status, 'slp');
		assert.equal(battle.p2.active[0].status, '');
	});

	it('blocks the sleep secondary of Dire Claw while retaining its attack damage', () => {
		create([{ species: 'Sneasler', ability: 'pressure', moves: ['direclaw'] }], [
			{ species: 'Cresselia', ability: 'levitate', moves: ['splash'], evs: { hp: 252, def: 252 } },
			{ species: 'Uxie', ability: 'levitate', moves: ['splash'], evs: { hp: 252, def: 252 } },
		]);
		const nativeSample = battle.sample.bind(battle);
		battle.sample = items => items.includes('slp') ? 'slp' : nativeSample(items);
		battle.makeChoices('move direclaw', 'move splash');
		const first = battle.p2.active[0];
		assert.equal(first.status, 'slp');
		const second = battle.p2.pokemon[1];
		battle.makeChoices('move direclaw', 'switch 2');
		assert.equal(first.status, 'slp');
		assert.equal(second.status, '');
		assert(second.hp < second.maxhp);
	});

	it('also guards the delayed G-Max Snooze effect without removing Gigantamax', () => {
		create([sleeper, { species: 'Grimmsnarl', ability: 'prankster', gigantamax: true, moves: ['crunch', 'splash'] }], [
			{ species: 'Blissey', ability: 'serenegrace', moves: ['splash'] },
			{ species: 'Chansey', ability: 'healer', item: 'eviolite', moves: ['splash'] },
		]);
		battle.makeChoices('move spore', 'move splash');
		const first = battle.p2.active[0];
		battle.makeChoices('switch 2', 'switch 2');
		// G-Max Snooze applies Yawn when its 1/2 early-return roll is false.
		battle.randomChance = () => false;
		battle.makeChoices('move crunch dynamax', 'move splash');
		assert(battle.p1.active[0].volatiles.dynamax);
		assert(battle.log.some(line => line.includes('|G-Max Snooze|')));
		assert(battle.p2.active[0].volatiles.yawn);
		battle.makeChoices('move splash', 'move splash');
		assert.equal(first.status, 'slp');
		assert.equal(battle.p2.active[0].status, '');
	});

	it('tracks the two players independently rather than imposing a global sleep limit', () => {
		create([
			{ species: 'Smeargle', moves: ['spore', 'splash'] },
			{ species: 'Smeargle', moves: ['splash'] },
		], [
			{ species: 'Smeargle', moves: ['splash'] },
			{ species: 'Smeargle', moves: ['spore'] },
		]);
		battle.makeChoices('move spore', 'move splash');
		const sleepingP2 = battle.p2.active[0];
		battle.makeChoices('switch 2', 'switch 2');
		battle.makeChoices('move splash', 'move spore');
		assert.equal(sleepingP2.status, 'slp');
		assert.equal(battle.p1.active[0].status, 'slp');
	});
});
