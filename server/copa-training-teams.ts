import { Dex } from '../sim/dex';
import { Teams } from '../sim/teams';
import { TeamValidator } from '../sim/team-validator';
import { COPA_FORMAT } from './copa-format-policy';

// Curated movesets for the training roster. The fifth move is an alternate
// coverage or utility slot. Teams are curated separately for their match plan.
const roster = `
Greninja|Protean|Greninjite|Hydro Pump,Dark Pulse,Ice Beam,U-turn,Spikes
Talonflame|Gale Wings|Heavy-Duty Boots|Brave Bird,Flare Blitz,Roost,Will-O-Wisp,U-turn
Venusaur|Chlorophyll|Life Orb|Giga Drain,Sludge Bomb,Weather Ball,Growth,Sleep Powder
Sylveon|Pixilate|Leftovers|Hyper Voice,Wish,Protect,Calm Mind,Psyshock
Lucario|Inner Focus|Lucarionite Z|Close Combat,Extreme Speed,Swords Dance,Meteor Mash,Crunch
Goodra|Hydration|Assault Vest|Draco Meteor,Thunder,Surf,Sludge Bomb,Flamethrower
Infernape|Blaze|Life Orb|Close Combat,Flare Blitz,U-turn,Stone Edge,Mach Punch
Staraptor|Reckless|Choice Scarf|Brave Bird,Double-Edge,Close Combat,U-turn,Quick Attack
Luxray|Intimidate|Assault Vest|Wild Charge,Volt Switch,Crunch,Ice Fang,Superpower
Gyarados|Intimidate|Gyaradosite|Waterfall,Crunch,Ice Fang,Dragon Dance,Earthquake
Steelix|Sturdy|Smooth Rock|Sandstorm,Stealth Rock,Earthquake,Heavy Slam,Body Press
Sceptile|Overgrow|Sceptilite|Leaf Storm,Dragon Pulse,Focus Blast,Giga Drain,Earthquake
Aggron|Sturdy|Aggronite|Heavy Slam,Earthquake,Body Press,Stealth Rock,Thunder Wave
Gardevoir|Trace|Gardevoirite|Hyper Voice,Psyshock,Focus Blast,Calm Mind,Moonblast
Metagross|Clear Body|Metagrossite|Meteor Mash,Earthquake,Bullet Punch,Ice Punch,Zen Headbutt
Salamence|Intimidate|Salamencite|Double-Edge,Earthquake,Roost,Dragon Dance,Dragon Claw
Slaking|Truant|Choice Band|Double-Edge,Earthquake,Knock Off,Sucker Punch,Fire Punch
Lopunny|Limber|Lopunnite|Fake Out,Close Combat,Return,U-turn,Quick Attack
Lilligant-Hisui|Chlorophyll|Life Orb|Victory Dance,Close Combat,Leaf Blade,Ice Spinner,Sleep Powder
Garchomp|Sand Veil|Rocky Helmet|Earthquake,Dragon Claw,Stealth Rock,Swords Dance,Fire Fang
Zoroark-Hisui|Illusion|Choice Specs|Hyper Voice,Shadow Ball,Flamethrower,Trick,U-turn
Cresselia|Levitate|Mental Herb|Trick Room,Lunar Dance,Moonblast,Moonlight,Psychic
Swampert|Torrent|Swampertite|Waterfall,Earthquake,Ice Punch,Flip Turn,Stealth Rock
Manectric|Lightning Rod|Manectite|Volt Switch,Overheat,Thunderbolt,Hidden Power Ice,Flamethrower
Swellow|Guts|Flame Orb|Facade,Brave Bird,Quick Attack,U-turn,Protect
Breloom|Technician|Loaded Dice|Bullet Seed,Mach Punch,Spore,Rock Tomb,Swords Dance
Umbreon|Synchronize|Leftovers|Foul Play,Wish,Protect,Toxic,Heal Bell
Aegislash|Stance Change|Leftovers|King's Shield,Shadow Ball,Flash Cannon,Shadow Sneak,Close Combat
Incineroar|Intimidate|Heavy-Duty Boots|Flare Blitz,Knock Off,Parting Shot,Will-O-Wisp,U-turn
Salazzle|Corrosion|Heavy-Duty Boots|Flamethrower,Sludge Wave,Toxic,Protect,Substitute
Wishiwashi|Schooling|Life Orb|Hydro Pump,Ice Beam,Earthquake,U-turn,Scald
Ninetales|Drought|Heat Rock|Flamethrower,Solar Beam,Will-O-Wisp,Encore,Energy Ball
Ninetales-Alola|Snow Warning|Light Clay|Aurora Veil,Freeze-Dry,Moonblast,Encore,Blizzard
Raichu-Alola|Surge Surfer|Aloraichium Z|Thunderbolt,Psychic,Focus Blast,Nasty Plot,Surf
Gumshoos|Adaptability|Choice Band|Double-Edge,Earthquake,Crunch,U-turn,Fire Punch
Rillaboom|Grassy Surge|Assault Vest|Grassy Glide,Wood Hammer,Knock Off,U-turn,Drain Punch
Arcanine|Intimidate|Heavy-Duty Boots|Flare Blitz,Extreme Speed,Morning Sun,Will-O-Wisp,Wild Charge
Crustle|Sturdy|White Herb|Shell Smash,Stone Edge,X-Scissor,Earthquake,Stealth Rock
Blastoise|Torrent|White Herb|Shell Smash,Surf,Ice Beam,Dark Pulse,Flash Cannon
Arctozolt|Slush Rush|Heavy-Duty Boots|Bolt Beak,Blizzard,Low Kick,Substitute,Icicle Crash
Noivern|Infiltrator|Heavy-Duty Boots|Draco Meteor,Hurricane,U-turn,Roost,Flamethrower
Feraligatr|Sheer Force|Feraligite|Waterfall,Crunch,Ice Punch,Dragon Dance,Earthquake
Hypno|Insomnia|Leftovers|Trick Room,Psychic,Wish,Protect,Thunder Wave
Pidgeot|Keen Eye|Pidgeotite|Hurricane,Heat Wave,Roost,U-turn,Defog
Ampharos|Static|Ampharosite|Thunderbolt,Dragon Pulse,Focus Blast,Volt Switch,Discharge
Emboar|Reckless|Emboarite|Flare Blitz,Close Combat,Wild Charge,Sucker Punch,Head Smash
Bisharp|Defiant|Eviolite|Knock Off,Iron Head,Sucker Punch,Swords Dance,Low Kick
Seismitoad|Swift Swim|Life Orb|Hydro Pump,Earth Power,Sludge Wave,Stealth Rock,Focus Blast
Haxorus|Mold Breaker|Lum Berry|Dragon Dance,Dragon Claw,Earthquake,Poison Jab,Close Combat
Sigilyph|Magic Guard|Life Orb|Psychic,Air Slash,Heat Wave,Roost,Calm Mind
Whimsicott|Prankster|Heavy-Duty Boots|Moonblast,Encore,U-turn,Stun Spore,Tailwind
Samurott|Torrent|Life Orb|Swords Dance,Liquidation,Aqua Jet,Megahorn,Knock Off
Krookodile|Intimidate|Choice Scarf|Earthquake,Knock Off,Stone Edge,Close Combat,Stealth Rock
Braviary|Defiant|Heavy-Duty Boots|Brave Bird,Close Combat,Roost,U-turn,Bulk Up
Reuniclus|Magic Guard|Life Orb|Trick Room,Psychic,Focus Blast,Shadow Ball,Recover
Galvantula|Compound Eyes|Focus Sash|Sticky Web,Thunder,Bug Buzz,Energy Ball,Volt Switch
Chandelure|Flash Fire|Choice Specs|Fire Blast,Shadow Ball,Energy Ball,Trick,Overheat
Excadrill|Sand Rush|Life Orb|Earthquake,Iron Head,Rock Slide,Rapid Spin,Swords Dance
Blaziken|Speed Boost|Blazikenite|Protect,Swords Dance,Close Combat,Flare Blitz,Knock Off
Absol|Super Luck|Absolite Z|Knock Off,Sucker Punch,Play Rough,Swords Dance,Close Combat
Sharpedo|Speed Boost|Sharpedonite|Protect,Crunch,Liquidation,Ice Fang,Psychic Fangs
Altaria|Natural Cure|Altarianite|Dragon Dance,Return,Earthquake,Roost,Body Slam
Pelipper|Drizzle|Damp Rock|Hurricane,Surf,Roost,U-turn,Defog
Pinsir|Hyper Cutter|Pinsirite|Return,Quick Attack,Earthquake,Swords Dance,Close Combat
Zebstrika|Lightning Rod|Heavy-Duty Boots|Volt Switch,Thunderbolt,Overheat,Hidden Power Ice,Flame Charge
Cobalion|Justified|Leftovers|Close Combat,Iron Head,Volt Switch,Stealth Rock,Taunt
Hydreigon|Levitate|Darkinium Z|Dark Pulse,Draco Meteor,Flamethrower,Nasty Plot,Flash Cannon
Dewott|Torrent|Eviolite|Swords Dance,Liquidation,Aqua Jet,X-Scissor,Knock Off
Eelektross|Levitate|Assault Vest|Volt Switch,Giga Drain,Flamethrower,Knock Off,Thunderbolt
Mandibuzz|Overcoat|Heavy-Duty Boots|Foul Play,Roost,Defog,U-turn,Toxic
Flygon|Levitate|Choice Scarf|Earthquake,Dragon Claw,U-turn,Stone Edge,Outrage
Volcarona|Flame Body|Heavy-Duty Boots|Quiver Dance,Fiery Dance,Bug Buzz,Giga Drain,Roost
Samurott-Hisui|Sharpness|Focus Sash|Ceaseless Edge,Razor Shell,Aqua Jet, Sacred Sword,Knock Off
Scizor|Technician|Scizorite|Bullet Punch,U-turn,Close Combat,Swords Dance,Roost
Snorlax|Thick Fat|Leftovers|Curse,Body Slam,Earthquake,Rest,Crunch
Meowscarada|Protean|Choice Band|Flower Trick,Knock Off,U-turn,Triple Axel,Play Rough
Kilowattrel|Volt Absorb|Heavy-Duty Boots|Hurricane,Thunder,Volt Switch,Roost,Thunderbolt
Tinkaton|Mold Breaker|Leftovers|Gigaton Hammer,Knock Off,Stealth Rock,Encore,Thunder Wave
Clodsire|Unaware|Leftovers|Earthquake,Toxic,Recover,Spikes,Stealth Rock
Annihilape|Defiant|Leftovers|Rage Fist,Drain Punch,Bulk Up,Taunt,Rest
Baxcalibur|Thermal Exchange|Baxcalibrite|Glaive Rush,Icicle Crash,Earthquake,Dragon Dance,Ice Shard
Empoleon|Competitive|Leftovers|Surf,Flash Cannon,Roost,Stealth Rock,Ice Beam
Glaceon|Ice Body|Choice Specs|Blizzard,Freeze-Dry,Shadow Ball,Hidden Power Ground,Ice Beam
`.trim();

const lineups = [
	['Rain', 'Pelipper', 'Swampert', 'Goodra', 'Seismitoad', 'Scizor', 'Kilowattrel'],
	['Rain offense', 'Pelipper', 'Greninja', 'Blastoise', 'Samurott', 'Dewott', 'Raichu-Alola'],
	['Sun', 'Ninetales', 'Venusaur', 'Lilligant-Hisui', 'Infernape', 'Chandelure', 'Arcanine'],
	['Sun offense', 'Ninetales', 'Sceptile', 'Emboar', 'Blaziken', 'Volcarona', 'Tinkaton'],
	['Manual sand', 'Steelix', 'Excadrill', 'Garchomp', 'Aggron', 'Flygon', 'Cobalion'],
	['Snow and screens', 'Ninetales-Alola', 'Arctozolt', 'Glaceon', 'Baxcalibur', 'Steelix', 'Noivern'],
	['Trick Room', 'Cresselia', 'Reuniclus', 'Hypno', 'Snorlax', 'Ampharos', 'Wishiwashi'],
	['Bulky offense', 'Tinkaton', 'Gardevoir', 'Metagross', 'Aegislash', 'Incineroar', 'Rillaboom'],
	['VoltTurn', 'Manectric', 'Luxray', 'Eelektross', 'Zebstrika', 'Staraptor', 'Scizor'],
	['Defensive', 'Clodsire', 'Umbreon', 'Mandibuzz', 'Empoleon', 'Salazzle', 'Breloom'],
	['Web offense', 'Galvantula', 'Samurott-Hisui', 'Crustle', 'Haxorus', 'Lucario', 'Annihilape'],
	['Fast offense', 'Krookodile', 'Lopunny', 'Meowscarada', 'Hydreigon', 'Bisharp', 'Talonflame'],
	['Priority offense', 'Whimsicott', 'Feraligatr', 'Sharpedo', 'Absol', 'Zoroark-Hisui', 'Salamence'],
	['Balanced', 'Cobalion', 'Sylveon', 'Pidgeot', 'Gyarados', 'Gumshoos', 'Sigilyph'],
	['Balanced pivot', 'Tinkaton', 'Swellow', 'Slaking', 'Braviary', 'Altaria', 'Incineroar'],
	['Bulky pivot', 'Garchomp', 'Rillaboom', 'Blastoise', 'Empoleon', 'Pinsir', 'Sylveon'],
];

const supports = new Set([
	'Steelix', 'Cresselia', 'Pelipper', 'Ninetales', 'Ninetales-Alola', 'Hypno',
	'Umbreon', 'Tinkaton', 'Clodsire', 'Mandibuzz', 'Incineroar', 'Empoleon', 'Whimsicott',
]);
const slowAttackers = new Set(['Reuniclus', 'Wishiwashi', 'Ampharos', 'Snorlax']);
const dex = Dex.forFormat(COPA_FORMAT);

export function getTrainingBuilds() {
	const builds = new Map<string, PokemonSet[]>();
	for (const line of roster.split('\n')) {
		const [species, ability, item, pool] = line.split('|');
		const moves = pool.split(',').map(move => move.trim());
		const physical = moves.filter(move => dex.moves.get(move).category === 'Physical').length >
			moves.filter(move => dex.moves.get(move).category === 'Special').length;
		const attack = physical ? 'atk' : 'spa';
		const bulky = supports.has(species);
		const slow = slowAttackers.has(species);
		const main: PokemonSet = {
			name: species, species, ability, item, moves: moves.slice(0, 4), nature: bulky ? 'Calm' :
			slow ? (physical ? 'Brave' : 'Quiet') : (physical ? 'Jolly' : 'Timid'),
			evs: bulky ? { hp: 252, def: 4, spd: 252, atk: 0, spa: 0, spe: 0 } :
			{ hp: slow ? 252 : 4, atk: 0, def: 0, spa: 0, spd: slow ? 4 : 0, spe: slow ? 0 : 252, [attack]: 252 },
			ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: slow ? 0 : 31 },
			gender: '', level: 100, teraType: dex.species.get(species).types[0],
		};
		const alternate: PokemonSet = {
			...main, evs: { ...main.evs }, ivs: { ...main.ivs },
			moves: [...moves.slice(0, 3), moves[4]],
		};
		if (dex.items.get(item).megaStone) alternate.item = bulky ? 'Leftovers' : 'Life Orb';
		builds.set(species, [main, alternate]);
	}
	return builds;
}

export function buildTrainingTeams() {
	const builds = getTrainingBuilds();
	const validator = TeamValidator.get(COPA_FORMAT);
	const validate = (label: string, sets: PokemonSet[]) => {
		const problems = validator.validateTeam(sets);
		if (problems) throw new Error(`Training ${label}: ${problems.join(' ')}`);
	};
	for (const [species, variants] of builds) {
		for (const [index, set] of variants.entries()) validate(`${species} build ${index + 1}`, [structuredClone(set)]);
	}
	const used = new Set<string>();
	const teams = [];
	for (const [strategy, ...members] of lineups) {
		for (const species of members) used.add(species);
		for (let variant = 0; variant < 2; variant++) {
			const sets = members.map(species => structuredClone(builds.get(species)![variant]));
			validate(strategy, sets);
			teams.push({ strategy, team: Teams.pack(sets) });
		}
	}
	if (used.size !== builds.size) throw new Error('Training lineup does not cover the full roster');
	return teams;
}

let trainingTeams: ReturnType<typeof buildTrainingTeams> | undefined;
export function randomTrainingTeam(random = Math.random) {
	trainingTeams ||= buildTrainingTeams();
	return trainingTeams[Math.floor(random() * trainingTeams.length)].team;
}
