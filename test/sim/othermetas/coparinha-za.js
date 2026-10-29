'use strict';

const assert = require('../../assert');
const common = require('../../common');
const { Dex, TeamValidator } = require('../../../dist/sim');

// Golden data from smogon/pokemon-showdown ccfaa20f32af363569cd21a9d501b2bc1ded26b1.
// Forme, allowed starting forme(s), stone, types, HP/Atk/Def/SpA/SpD/Spe, default ability.
const ZA = [
	["Raichu-Mega-X", "Raichu", "Raichunite X", ["Electric"], [60, 135, 95, 90, 95, 110], "Electric Surge"],
	["Raichu-Mega-Y", "Raichu", "Raichunite Y", ["Electric"], [60, 100, 55, 160, 80, 130], "No Guard"],
	["Clefable-Mega", "Clefable", "Clefablite", ["Fairy", "Flying"], [95, 80, 93, 135, 110, 70], "Magic Bounce"],
	["Victreebel-Mega", "Victreebel", "Victreebelite", ["Grass", "Poison"], [80, 125, 85, 135, 95, 70], "Innards Out"],
	["Starmie-Mega", "Starmie", "Starminite", ["Water", "Psychic"], [60, 100, 105, 130, 105, 120], "Huge Power"],
	["Dragonite-Mega", "Dragonite", "Dragoninite", ["Dragon", "Flying"], [91, 124, 115, 145, 125, 100], "Multiscale"],
	["Meganium-Mega", "Meganium", "Meganiumite", ["Grass", "Fairy"], [80, 92, 115, 143, 115, 80], "Mega Sol"],
	["Feraligatr-Mega", "Feraligatr", "Feraligite", ["Water", "Dragon"], [85, 160, 125, 89, 93, 78], "Dragonize"],
	["Skarmory-Mega", "Skarmory", "Skarmorite", ["Steel", "Flying"], [65, 140, 110, 40, 100, 110], "Stalwart"],
	["Chimecho-Mega", "Chimecho", "Chimechite", ["Psychic", "Steel"], [75, 50, 110, 135, 120, 65], "Levitate"],
	["Absol-Mega-Z", "Absol", "Absolite Z", ["Dark", "Ghost"], [65, 154, 60, 75, 60, 151], "Sharpness"],
	["Staraptor-Mega", "Staraptor", "Staraptite", ["Fighting", "Flying"], [85, 140, 100, 60, 90, 110], "Contrary"],
	["Garchomp-Mega-Z", "Garchomp", "Garchompite Z", ["Dragon"], [108, 130, 85, 141, 85, 151], "Levitate"],
	["Lucario-Mega-Z", "Lucario", "Lucarionite Z", ["Fighting", "Steel"], [70, 100, 70, 164, 70, 151], "Aura Guard"],
	["Froslass-Mega", "Froslass", "Froslassite", ["Ice", "Ghost"], [70, 80, 70, 140, 100, 120], "Snow Warning"],
	["Heatran-Mega", "Heatran", "Heatranite", ["Fire", "Steel"], [91, 120, 106, 175, 141, 67], "Flash Fire"],
	["Darkrai-Mega", "Darkrai", "Darkranite", ["Dark"], [70, 120, 130, 165, 130, 85], "Bad Dreams"],
	["Emboar-Mega", "Emboar", "Emboarite", ["Fire", "Fighting"], [110, 148, 75, 110, 110, 75], "Mold Breaker"],
	["Excadrill-Mega", "Excadrill", "Excadrite", ["Ground", "Steel"], [110, 165, 100, 65, 65, 103], "Piercing Drill"],
	["Scolipede-Mega", "Scolipede", "Scolipite", ["Bug", "Poison"], [60, 140, 149, 75, 99, 62], "Shell Armor"],
	["Scrafty-Mega", "Scrafty", "Scraftinite", ["Dark", "Fighting"], [65, 130, 135, 55, 135, 68], "Intimidate"],
	["Eelektross-Mega", "Eelektross", "Eelektrossite", ["Electric"], [85, 145, 80, 135, 90, 80], "Eelevate"],
	["Chandelure-Mega", "Chandelure", "Chandelurite", ["Ghost", "Fire"], [60, 75, 110, 175, 110, 90], "Infiltrator"],
	["Golurk-Mega", "Golurk", "Golurkite", ["Ground", "Ghost"], [89, 159, 105, 70, 105, 55], "Unseen Fist"],
	["Chesnaught-Mega", "Chesnaught", "Chesnaughtite", ["Grass", "Fighting"], [88, 137, 172, 74, 115, 44], "Bulletproof"],
	["Delphox-Mega", "Delphox", "Delphoxite", ["Fire", "Psychic"], [75, 69, 72, 159, 125, 134], "Levitate"],
	["Greninja-Mega", "Greninja", "Greninjite", ["Water", "Dark"], [72, 125, 77, 133, 81, 142], "Protean"],
	["Pyroar-Mega", "Pyroar", "Pyroarite", ["Fire", "Normal"], [86, 88, 92, 129, 86, 126], "Fire Mane"],
	["Floette-Mega", "Floette-Eternal", "Floettite", ["Fairy"], [74, 85, 87, 155, 148, 102], "Fairy Aura"],
	["Meowstic-M-Mega", "Meowstic", "Meowsticite", ["Psychic"], [74, 48, 76, 143, 101, 124], "Trace"],
	["Meowstic-F-Mega", "Meowstic-F", "Meowsticite", ["Psychic"], [74, 48, 76, 143, 101, 124], "Trace"],
	["Malamar-Mega", "Malamar", "Malamarite", ["Dark", "Psychic"], [86, 102, 88, 98, 120, 88], "Contrary"],
	["Barbaracle-Mega", "Barbaracle", "Barbaracite", ["Rock", "Fighting"], [72, 140, 130, 64, 106, 88], "Tough Claws"],
	["Dragalge-Mega", "Dragalge", "Dragalgite", ["Poison", "Dragon"], [65, 85, 105, 132, 163, 44], "Regenerator"],
	["Hawlucha-Mega", "Hawlucha", "Hawluchanite", ["Fighting", "Flying"], [78, 137, 100, 74, 93, 118], "No Guard"],
	["Zygarde-Mega", ["Zygarde", "Zygarde-10%"], "Zygardite", ["Dragon", "Ground"], [216, 70, 91, 216, 85, 100], "Aura Break"],
	["Crabominable-Mega", "Crabominable", "Crabominite", ["Fighting", "Ice"], [97, 157, 122, 62, 107, 33], "Iron Fist"],
	["Golisopod-Mega", "Golisopod", "Golisopite", ["Bug", "Steel"], [75, 150, 175, 70, 120, 40], "Tough Claws"],
	["Drampa-Mega", "Drampa", "Drampanite", ["Normal", "Dragon"], [78, 85, 110, 160, 116, 36], "Berserk"],
	["Magearna-Mega", "Magearna", "Magearnite", ["Steel", "Fairy"], [80, 125, 115, 170, 115, 95], "Soul-Heart"],
	["Magearna-Original-Mega", "Magearna-Original", "Magearnite", ["Steel", "Fairy"], [80, 125, 115, 170, 115, 95], "Soul-Heart"],
	["Zeraora-Mega", "Zeraora", "Zeraorite", ["Electric"], [88, 157, 75, 147, 80, 153], "Volt Absorb"],
	["Falinks-Mega", "Falinks", "Falinksite", ["Fighting"], [65, 135, 135, 70, 65, 100], "Defiant"],
	["Scovillain-Mega", "Scovillain", "Scovillainite", ["Grass", "Fire"], [65, 138, 85, 138, 85, 75], "Spicy Spray"],
	["Glimmora-Mega", "Glimmora", "Glimmoranite", ["Rock", "Poison"], [83, 90, 105, 150, 96, 101], "Adaptability"],
	["Tatsugiri-Curly-Mega", "Tatsugiri", "Tatsugirinite", ["Dragon", "Water"], [68, 65, 90, 135, 125, 92], "Commander"],
	["Tatsugiri-Droopy-Mega", "Tatsugiri-Droopy", "Tatsugirinite", ["Dragon", "Water"], [68, 65, 90, 135, 125, 92], "Commander"],
	["Tatsugiri-Stretchy-Mega", "Tatsugiri-Stretchy", "Tatsugirinite", ["Dragon", "Water"], [68, 65, 90, 135, 125, 92], "Commander"],
	["Baxcalibur-Mega", "Baxcalibur", "Baxcalibrite", ["Dragon", "Ice"], [115, 175, 117, 105, 101, 87], "Thermal Exchange"],
];
const formatid = 'gen9coparinhanationaldexza';
const statNames = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
function set(species, item, moves = ['Sleep Talk']) {
	return {
		species, item, moves, ability: species.startsWith('Zygarde') ? 'Power Construct' : Dex.species.get(species).abilities[0],
		level: 100, nature: 'Hardy', evs: { hp: 252 }, teraType: 'Water',
	};
}

describe('Copa Rinha upstream Legends Z-A Megas', () => {
	let battle;
	afterEach(() => {
		battle?.destroy();
		battle = null;
	});
	function create(team, opponent = [
		{ species: 'Arceus', ability: 'Multitype', moves: ['Sleep Talk'], evs: { hp: 252 } },
		{ species: 'Blissey', ability: 'Natural Cure', moves: ['Sleep Talk'] },
	]) {
		battle = common.createBattle({ formatid }, [team, opponent]);
		battle.makeChoices('team 123456', 'team 123456');
		return battle.p1.active[0];
	}
	function switchTo(name) {
		const index = battle.p1.pokemon.findIndex(p => p.baseSpecies.name === name);
		assert(index > 0, `inactive ${name} is on the team`);
		battle.makeChoices(`switch ${index + 1}`, 'auto');
		return battle.p1.active[0];
	}
	function noOptions(pokemon) {
		const request = pokemon.getMoveRequestData();
		assert(!request.canMegaEvo);
		assert(!request.canZMove);
		assert(!request.canDynamax);
		assert(!request.canTerastallize);
	}

	it('covers every Gen 9 Mega and matching stone in the audited upstream snapshot', () => {
		assert.equal(ZA.length, 49);
		const compare = (a, b) => a.localeCompare(b);
		const expected = ZA.map(row => Dex.toID(row[0])).sort(compare);
		assert.deepEqual(Dex.species.all().filter(s => s.isMega && s.gen === 9).map(s => s.id).sort(compare), expected);
		assert.equal(new Set(ZA.map(row => row[2])).size, 45);
		for (const [name, bases, stone] of ZA) {
			assert(Object.values(Dex.items.get(stone).megaStone).includes(name), `${stone} reaches ${name}`);
			for (const base of [].concat(bases)) assert(Dex.species.get(base).exists);
		}
	});

	it('keeps ZA Future data unavailable in official National Dex without enabling all Future content in Copa Rinha', () => {
		assert.equal(Dex.mod('gen9').species.get('Clefable-Mega').isNonstandard, 'Future');
		assert.equal(Dex.mod('gen9').items.get('Clefablite').isNonstandard, 'Future');
		assert(!new TeamValidator(formatid).ruleTable.has('+tag:future'));
		const problems = new TeamValidator('gen9nationaldexag').validateTeam([set('Clefable', 'Clefablite')]);
		assert(problems?.some(problem => problem.includes('does not exist')));
	});

	for (const [name, bases, stone, types, stats, ability] of ZA) {
		for (const base of [].concat(bases)) {
			it(`${base} @ ${stone} reaches ${name} with upstream types, stats and ability`, () => {
				const team = [set(base, stone)];
				assert.equal(new TeamValidator(formatid).validateTeam(team), null);
				const pokemon = create(team);
				if (base.startsWith('Zygarde')) {
					assert(!pokemon.canMegaEvo, 'Power Construct is required before Mega Evolution');
					pokemon.hp = Math.floor(pokemon.maxhp / 2);
					battle.makeChoices();
					assert.species(pokemon, 'Zygarde-Complete');
				}
				const request = pokemon.getMoveRequestData();
				assert.equal(pokemon.canMegaEvo, name);
				assert(request.canMegaEvo && request.canDynamax && request.canTerastallize);
				battle.makeChoices('move 1 mega', 'auto');
				assert.species(pokemon, name);
				assert.deepEqual(pokemon.getTypes(), types);
				assert.deepEqual(Object.fromEntries(statNames.map((stat, i) => [stat, stats[i]])), pokemon.species.baseStats);
				// Level 100, neutral nature, 31 IVs, 0 non-HP EVs: actual stats = 2 * base + 36.
				for (const [i, stat] of statNames.entries()) {
					if (stat === 'hp') continue;
					assert.equal(pokemon.storedStats[stat], 2 * stats[i] + 36, stat);
				}
				assert.equal(pokemon.maxhp, 2 * stats[0] + 204);
				assert.hasAbility(pokemon, ability);
				assert.equal(pokemon.m.copaRinhaMechanic, 'mega');
				noOptions(pokemon);
			});
		}
	}

	it('validates all new stones in mixed teams with old Mega Stones', () => {
		const validator = new TeamValidator(formatid);
		for (let index = 0; index < ZA.length; index += 5) {
			const team = [set('Venusaur', 'Venusaurite'), ...ZA.slice(index, index + 5).map(([, bases, stone]) =>
				set([].concat(bases)[0], stone))];
			assert.equal(validator.validateTeam(team), null, `mixed team ${index}`);
		}
	});

	it('keeps the upstream default Mega ability when a multi-ability base starts with its hidden ability', () => {
		for (const [base, stone, hidden, expected] of [
			['Heatran', 'Heatranite', 'Flame Body', 'Flash Fire'],
			['Tatsugiri', 'Tatsugirinite', 'Storm Drain', 'Commander'],
		]) {
			const team = [{ ...set(base, stone), ability: hidden }];
			assert.equal(new TeamValidator(formatid).validateTeam(team), null);
			const pokemon = create(team);
			assert.hasAbility(pokemon, hidden);
			battle.makeChoices('move 1 mega', 'auto');
			assert.hasAbility(pokemon, expected);
			battle.destroy();
			battle = null;
		}
	});

	it('does not restore the team Mega allowance when Power Construct activates after an ally Mega Evolves', () => {
		create([set('Clefable', 'Clefablite'), set('Zygarde', 'Zygardite')]);
		battle.makeChoices('move 1 mega', 'auto');
		const zygarde = switchTo('Zygarde');
		assert.equal(zygarde.canMegaEvo, false);
		zygarde.hp = Math.floor(zygarde.maxhp / 2);
		battle.makeChoices();
		assert.species(zygarde, 'Zygarde-Complete');
		assert.equal(zygarde.canMegaEvo, false);
		assert.throws(() => battle.makeChoices('move 1 mega', 'auto'), /Invalid choice/);
	});

	it('allows several old and new stones but only one actual Mega per player', () => {
		const team = [set('Clefable', 'Clefablite'), set('Dragonite', 'Dragoninite'), set('Venusaur', 'Venusaurite'), set('Lucario', 'Lucarionite')];
		assert.equal(new TeamValidator(formatid).validateTeam(team), null);
		create(team, structuredClone(team));
		for (const side of battle.sides) assert(side.pokemon.every(p => p.canMegaEvo));
		battle.makeChoices('move 1 mega', 'move 1 mega');
		for (const side of battle.sides) {
			for (const pokemon of side.pokemon) assert(!pokemon.canMegaEvo);
		}
		battle.makeChoices('switch 2', 'switch 2');
		for (const side of battle.sides) assert.throws(() => side.choose('move 1 mega'), /Invalid choice/);
		for (const name of ['Venusaur', 'Lucario']) {
			switchTo(name);
			assert.throws(() => battle.makeChoices('move 1 mega', 'auto'), /Invalid choice/);
		}
		for (const player of ['p1', 'p2']) assert.equal(battle.log.filter(line => line.startsWith(`|-mega|${player}`)).length, 1);
	});

	it('using Dynamax with a ZA stone blocks only that Pokemon and leaves another Mega usable', () => {
		const pokemon = create([set('Clefable', 'Clefablite'), set('Venusaur', 'Venusaurite')]);
		battle.makeChoices('move 1 dynamax', 'auto');
		noOptions(pokemon);
		battle.makeChoices();
		battle.makeChoices();
		assert(!pokemon.volatiles.dynamax);
		assert.throws(() => battle.makeChoices('move 1 mega', 'auto'), /Invalid choice/);
		assert.throws(() => battle.makeChoices('move 1 terastallize', 'auto'), /Invalid choice/);
		const other = switchTo('Venusaur');
		battle.makeChoices('move 1 mega', 'auto');
		assert.species(other, 'Venusaur-Mega');
	});

	it('using Tera with a ZA stone preserves the other players independent Mega and Dynamax allowances', () => {
		const pokemon = create([set('Clefable', 'Clefablite'), set('Meganium', 'Meganiumite')]);
		battle.makeChoices('move 1 terastallize', 'auto');
		noOptions(pokemon);
		assert(!battle.p1.dynamaxUsed);
		assert.throws(() => battle.makeChoices('move 1 mega', 'auto'), /Invalid choice/);
		const other = switchTo('Meganium');
		assert(other.canMegaEvo);
		assert(other.getMoveRequestData().canDynamax);
		battle.makeChoices('move 1 mega', 'auto');
		assert.species(other, 'Meganium-Mega');
	});

	it('uses ZA Mega, Z-Move, Dynamax and Tera in the same battle on different Pokemon', () => {
		create([set('Venusaur', 'Venusaurite'), set('Clefable', 'Clefablite'),
			set('Pikachu', 'Pikanium Z', ['Volt Tackle']), set('Garchomp', '')]);
		battle.makeChoices('move 1 dynamax', 'auto');
		const mega = switchTo('Clefable');
		battle.makeChoices('move 1 mega', 'auto');
		assert.species(mega, 'Clefable-Mega');
		switchTo('Pikachu');
		battle.makeChoices('move 1 zmove', 'auto');
		assert(battle.p1.zMoveUsed);
		const tera = switchTo('Garchomp');
		battle.makeChoices('move 1 terastallize', 'auto');
		assert.equal(tera.terastallized, 'Water');
		assert(battle.p1.dynamaxUsed);
		for (const pokemon of battle.p1.pokemon) noOptions(pokemon);
	});

	it('preserves Pikachu G-Max plus a ZA Mega, another Pokemon Z-Move and Tera', () => {
		const pikachu = create([{ ...set('Pikachu', 'Pikanium Z', ['Volt Tackle', 'Sleep Talk']), gigantamax: true },
			set('Clefable', 'Clefablite'), set('Mew', 'Normalium Z', ['Splash']), set('Garchomp', '')]);
		const options = pikachu.getMoveRequestData();
		assert(options.canZMove && options.canDynamax && options.canTerastallize);
		assert.equal(options.maxMoves.gigantamax, 'G-Max Volt Crash');
		battle.makeChoices('move 1 dynamax', 'auto');
		assert(battle.log.some(line => line.includes('G-Max Volt Crash')));
		noOptions(pikachu);
		const mega = switchTo('Clefable');
		battle.makeChoices('move 1 mega', 'auto');
		assert.species(mega, 'Clefable-Mega');
		const zUser = switchTo('Mew');
		battle.makeChoices('move 1 zmove', 'auto');
		assert.equal(zUser.m.copaRinhaMechanic, 'zmove');
		const tera = switchTo('Garchomp');
		battle.makeChoices('move 1 terastallize', 'auto');
		assert.equal(tera.terastallized, 'Water');
	});

	it('uses Solar Beam immediately through upstream Mega Sol without setting global weather', () => {
		const pokemon = create([set('Meganium', 'Meganiumite', ['Solar Beam'])]);
		const target = battle.p2.active[0];
		battle.makeChoices('move 1 mega', 'auto');
		assert.hasAbility(pokemon, 'Mega Sol');
		assert(target.hp < target.maxhp, 'Solar Beam attacks on the Mega Evolution turn');
		assert(!pokemon.volatiles.twoturnmove, 'no second charging turn remains');
		assert.equal(battle.field.weather, '');
	});

	it('activates upstream Dragonize so Mega Feraligatr Normal moves hit a Ghost as Dragon', () => {
		create([set('Feraligatr', 'Feraligite', ['Tackle'])], [
			{ species: 'Giratina', ability: 'Pressure', moves: ['Sleep Talk'] },
		]);
		const target = battle.p2.active[0];
		battle.makeChoices('move 1 mega', 'auto');
		assert.hasAbility(battle.p1.active[0], 'Dragonize');
		assert(target.hp < target.maxhp);
		assert(battle.log.some(line => line.startsWith('|-supereffective|p2')));
	});
});
