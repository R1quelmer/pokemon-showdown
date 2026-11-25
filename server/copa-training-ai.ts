import { Dex, toID } from '../sim/dex';
import type { Move } from '../sim/dex-moves';
import type { ChoiceRequest, PokemonSwitchRequestData } from '../sim/side';
import { COPA_FORMAT } from './copa-format-policy';

const dex = Dex.forFormat(COPA_FORMAT);
const hazards = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);
const removal = new Set(['rapidspin', 'defog', 'mortalspin', 'courtchange']);
const limitedSetup = new Set(['sandstorm', 'trickroom', 'auroraveil', 'reflect', 'lightscreen', 'tailwind']);
const pivot = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot']);
const immuneAbilities: Record<string, string> = {
	levitate: 'Ground', flashfire: 'Fire', wellbakedbody: 'Fire', waterabsorb: 'Water', stormdrain: 'Water',
	dryskin: 'Water', voltabsorb: 'Electric', lightningrod: 'Electric', motordrive: 'Electric',
	sapsipper: 'Grass', eartheater: 'Ground',
};

type Combatant = {
	species: string, hp: number, status: string, ability: string, item: string,
	tera: string, types?: string[], moves: Set<string>, boosts: Partial<BoostsTable>,
	stats?: StatsExceptHPTable,
	entered: number,
};
type SideState = {
	active?: Combatant, statused: Map<string, Combatant>, hazards: Map<string, number>, effects: Set<string>,
};

function sideState(): SideState {
	return { statused: new Map(), hazards: new Map(), effects: new Set() };
}
function hpFraction(condition: string) {
	const [value, max] = condition.split(' ')[0].split('/').map(Number);
	return max ? value / max : value ? 1 : 0;
}
function boost(stage = 0) {
	return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}
function types(pokemon: Combatant) {
	return pokemon.tera && pokemon.tera !== 'Stellar' ? [pokemon.tera] :
		pokemon.types || dex.species.get(pokemon.species).types;
}

// The controller accepts only spectator protocol and its own side's requests.
export class CopaTrainingAI {
	private sides = { p1: sideState(), p2: sideState() };
	private weather = '';
	private trickRoom = false;
	private turn = 0;
	private lastSwitch = -2;
	private random: () => number;
	constructor(random = Math.random) {
		this.random = random;
	}

	observe(lines: readonly string[]) {
		for (const line of lines) {
			const [, action, target = '', value = '', extra = '', source = ''] = line.split('|');
			if (action === 'turn') this.turn = Number(target);
			if (action === '-weather') this.weather = target === 'none' ? '' : toID(target);
			if (action === '-clearallboost') {
				for (const { active } of Object.values(this.sides)) {
					if (active) active.boosts = {};
				}
			}
			if (toID(target) === 'movetrickroom') {
				if (action === '-fieldstart') this.trickRoom = true;
				if (action === '-fieldend') this.trickRoom = false;
			}
			const side = target.startsWith('p1') ? this.sides.p1 : target.startsWith('p2') ? this.sides.p2 : null;
			if (!side) continue;
			if (action === '-sidestart' || action === '-sideend') {
				const condition = toID(value.replace(/^move: /, ''));
				if (action === '-sideend') {
					side.hazards.delete(condition);
					side.effects.delete(condition);
				} else if (hazards.has(condition)) {
					side.hazards.set(condition, (side.hazards.get(condition) || 0) + 1);
				} else {
					side.effects.add(condition);
				}
			}
			if (action === 'switch' || action === 'drag' || action === 'replace') {
				const key = target.slice(target.indexOf(':') + 1).trim();
				const previous = side.statused.get(key);
				side.active = {
					species: value.split(',')[0], hp: hpFraction(extra), status: extra.split(' ')[1] || '',
					ability: previous?.ability || '', item: previous?.item || '', tera: previous?.tera || '',
					moves: previous?.moves || new Set(), boosts: {}, entered: this.turn,
				};
				side.statused.set(key, side.active);
			}
			const pokemon = side.active;
			if (!pokemon || !/^p[12]a:/.test(target)) continue;
			switch (action) {
			case 'move':
				pokemon.moves.add(value);
				break;
			case 'detailschange':
			case '-formechange':
				pokemon.species = value.split(',')[0];
				break;
			case '-terastallize':
				pokemon.tera = value;
				break;
			case '-start':
				if (value === 'typechange') pokemon.types = extra.split('/');
				break;
			case '-damage':
			case '-heal':
				pokemon.hp = hpFraction(value);
				break;
			case '-status':
				pokemon.status = value === 'slp' && extra === '[from] move: Rest' ? 'rest' : value;
				break;
			case '-curestatus':
			case 'faint':
				pokemon.status = '';
				if (action === 'faint') pokemon.hp = 0;
				break;
			case '-ability':
				pokemon.ability = toID(value);
				break;
			case '-item':
			case '-enditem':
				pokemon.item = action === '-item' ? toID(value) : '';
				break;
			case '-boost':
			case '-unboost':
			case '-setboost': {
				const stat = value as BoostID;
				const change = Number(extra) || 0;
				pokemon.boosts[stat] = action === '-setboost' ? change :
					(pokemon.boosts[stat] || 0) + (action === '-boost' ? change : -change);
				break;
			}
			case '-clearboost':
				pokemon.boosts = {};
				break;
			}
			// Some public immunities disclose the defender's ability here.
			if (action === '-immune') {
				const revealed = [value, extra, source].find(field => field.startsWith('[from] ability: '));
				if (revealed) pokemon.ability = toID(revealed.slice('[from] ability: '.length));
			}
		}
	}

	private own(set: PokemonSwitchRequestData, active: boolean): Combatant {
		const visible = active ? this.sides.p2.active : undefined;
		return {
			species: set.details.split(',')[0], hp: hpFraction(set.condition), status: set.condition.split(' ')[1] || '',
			ability: set.ability || set.baseAbility, item: set.item, tera: set.terastallized || '',
			types: visible?.types, moves: new Set(set.moves), boosts: visible?.boosts || {}, stats: set.stats,
			entered: visible?.entered ?? this.turn,
		};
	}

	private multiplier(type: string, attacker: Combatant, defender: Combatant) {
		const targetTypes = types(defender);
		const ability = ['moldbreaker', 'teravolt', 'turboblaze'].includes(attacker.ability) ? '' : defender.ability;
		if (type === 'Ground' && defender.item === 'airballoon') return 0;
		if (immuneAbilities[ability] === type) return 0;
		const affected = (attacker.ability === 'scrappy' && ['Normal', 'Fighting'].includes(type)) ?
			targetTypes.filter(target => target !== 'Ghost') : targetTypes;
		if (!dex.getImmunity(type, affected)) return 0;
		let result = 2 ** dex.getEffectiveness(type, affected);
		if (ability === 'wonderguard' && result <= 1) return 0;
		if (ability === 'thickfat' && ['Fire', 'Ice'].includes(type)) result *= 0.5;
		if (ability === 'multiscale' && defender.hp >= 0.99) result *= 0.5;
		return result;
	}

	private damage(move: Move, attacker: Combatant, defender: Combatant, power = move.basePower) {
		if (move.category === 'Status') return 0;
		let type = move.type;
		const ate = { aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric' };
		if (type === 'Normal' && attacker.ability in ate) {
			type = ate[attacker.ability as keyof typeof ate];
			power *= 1.2;
		}
		const effectiveness = this.multiplier(type, attacker, defender);
		if (!effectiveness) return 0;
		if (move.damage === 'level') return 0.3;
		if (typeof move.damage === 'number') return move.damage / 300;
		if (move.ohko) return 0.14;
		const species = dex.species.get(attacker.species);
		const target = dex.species.get(defender.species);
		const physical = move.category === 'Physical';
		const attack = physical ? 'atk' : 'spa';
		const defense = move.id === 'psyshock' || physical ? 'def' : 'spd';
		const attackValue = (attacker.stats?.[attack] || 2 * species.baseStats[attack] + 70) * boost(attacker.boosts[attack]);
		const defenseStat = defender.stats?.[defense] || 2 * target.baseStats[defense] + 45;
		const defenseValue = defenseStat * boost(defender.boosts[defense]);
		const maxHP = target.baseStats.hp * 2 + 155;
		const originalTypes = attacker.types || species.types;
		let stab = originalTypes.includes(type) || attacker.tera === type ? 1.5 : 1;
		if (attacker.tera === type && originalTypes.includes(type)) stab = 2;
		if (stab > 1 && attacker.ability === 'adaptability') stab += 0.5;
		if (attacker.status === 'brn' && physical && attacker.ability !== 'guts' && move.id !== 'facade') stab *= 0.5;
		if (attacker.status && physical && attacker.ability === 'guts') stab *= 1.5;
		if (attacker.item === 'lifeorb') stab *= 1.3;
		if ((physical && attacker.item === 'choiceband') || (!physical && attacker.item === 'choicespecs')) stab *= 1.5;
		if (defender.item === 'eviolite') stab /= 1.5;
		if (move.id === 'facade' && attacker.status) power *= 2;
		if (power && move.multihit) {
			power *= typeof move.multihit === 'number' ? move.multihit : attacker.item === 'loadeddice' ? 4.5 : 3;
		}
		if (type === 'Water') stab *= this.weather === 'raindance' ? 1.5 : this.weather === 'sunnyday' ? 0.5 : 1;
		if (type === 'Fire') stab *= this.weather === 'sunnyday' ? 1.5 : this.weather === 'raindance' ? 0.5 : 1;
		return ((0.84 * (power || 75) * attackValue / defenseValue + 2) * stab * effectiveness * 0.92) / maxHP;
	}

	private threat(attacker: Combatant, defender: Combatant) {
		let estimate = 0;
		for (const name of attacker.moves) estimate = Math.max(estimate, this.damage(dex.moves.get(name), attacker, defender));
		// Unrevealed moves are estimated from the visible species' typing, never its set.
		for (const type of types(attacker)) estimate = Math.max(estimate, this.multiplier(type, attacker, defender) * 0.24);
		return estimate;
	}

	private speed(pokemon: Combatant) {
		let value = (pokemon.stats?.spe || 2 * dex.species.get(pokemon.species).baseStats.spe + 60) * boost(pokemon.boosts.spe);
		if (pokemon.item === 'choicescarf') value *= 1.5;
		if (pokemon.status === 'par' && pokemon.ability !== 'quickfeet') value *= 0.5;
		if ((pokemon.ability === 'swiftswim' && this.weather === 'raindance') ||
			(pokemon.ability === 'chlorophyll' && this.weather === 'sunnyday') ||
			(pokemon.ability === 'sandrush' && this.weather === 'sandstorm') ||
			(pokemon.ability === 'slushrush' && this.weather === 'snow')) value *= 2;
		return this.trickRoom ? -value : value;
	}

	private entryDamage(pokemon: Combatant) {
		if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') return 0;
		const own = this.sides.p2.hazards;
		const rock = own.has('stealthrock') ? (2 ** dex.getEffectiveness('Rock', types(pokemon))) / 8 : 0;
		if (types(pokemon).includes('Flying') || pokemon.ability === 'levitate' || pokemon.item === 'airballoon') return rock;
		return rock + (own.get('spikes') || 0) / 12 + (own.has('toxicspikes') ? 0.07 : 0) + (own.has('stickyweb') ? 0.04 : 0);
	}

	private score(move: Move, own: Combatant, foe: Combatant, power?: number) {
		if (move.id === 'fakeout' && this.turn > own.entered + 1) return -3;
		const risk = this.threat(foe, own);
		const faster = this.speed(own) >= this.speed(foe);
		const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
		let score = 0;
		if (move.category !== 'Status') {
			const damage = this.damage(move, own, foe, power);
			if (!damage) return -3;
			score = 2 * Math.min(damage, foe.hp) + (damage >= foe.hp ? (faster || move.priority > 0 ? 1 : 0.6) : 0);
			score *= accuracy;
			score += move.priority > 0 && !faster ? 0.16 : 0;
			if (move.drain && own.hp < 0.75) score += Math.min(damage, foe.hp) * 0.55;
			if (move.recoil && own.hp < 0.35) score -= 0.14;
		}
		const id = move.id;
		if (removal.has(id) && this.sides.p2.hazards.size) score += 0.18 + 0.12 * this.sides.p2.hazards.size;
		if (move.heal || id === 'wish' || id === 'rest') {
			score += own.hp < 0.66 && own.hp > risk * (faster ? 0.48 : 1.15) && risk < 0.42 ?
				Math.min(0.85, (1 - own.hp) * 1.3) : -0.4;
			if (id === 'rest') score -= 0.2;
		}
		if (hazards.has(id) || id === 'ceaselessedge') {
			const hazard = id === 'ceaselessedge' ? 'spikes' : id;
			const layers = this.sides.p1.hazards.get(hazard) || 0;
			if (layers < (hazard === 'spikes' ? 3 : hazard === 'toxicspikes' ? 2 : 1)) {
				score += (this.turn < 12 ? 0.72 : 0.32) / (layers + 1) - risk * 0.85;
			}
		}
		if (limitedSetup.has(id)) {
			const already = this.sides.p2.effects.has(id) || (id === 'trickroom' && this.trickRoom) || id === this.weather;
			if (!already) {
				const fits = (id !== 'trickroom' || !faster) && (id !== 'auroraveil' || this.weather === 'snow');
				score += fits ? 0.94 - risk * 0.65 : -0.3;
			}
		}
		const boosts = move.target === 'self' ? move.boosts : move.self?.boosts;
		if (boosts && risk < own.hp * 0.64) {
			for (const [key, amount] of Object.entries(boosts)) {
				if (amount > 0 && (own.boosts[key as BoostID] || 0) < 3) score += amount * (risk < 0.22 ? 0.22 : 0.13);
			}
		}
		if (move.status && !foe.status) {
			const sleepClause = move.status === 'slp' && [...this.sides.p1.statused.values()].some(p => p.status === 'slp');
			const foeTypes = types(foe);
			const poisonImmune = ['psn', 'tox'].includes(move.status) && own.ability !== 'corrosion' &&
				foeTypes.some(type => type === 'Steel' || type === 'Poison');
			const powderImmune = move.flags.powder &&
				(foeTypes.includes('Grass') || foe.ability === 'overcoat' || foe.item === 'safetygoggles');
			const blocked = poisonImmune || powderImmune || (move.status === 'brn' && foeTypes.includes('Fire')) ||
				(move.status === 'par' && foeTypes.includes('Electric'));
			if (!sleepClause && !blocked && (id !== 'thunderwave' || this.multiplier('Electric', own, foe))) {
				score += accuracy * (move.status === 'slp' ? 0.86 : 0.63) - risk * 0.35;
			}
		}
		if (pivot.has(id) && risk > 0.28) score += 0.18;
		return score;
	}

	choose(request: ChoiceRequest): string | null {
		if (request.wait) return null;
		const pokemon = request.side.pokemon;
		if (request.teamPreview) return 'team ' + pokemon.map((_, i) => i + 1).join('');
		const foe = this.sides.p1.active?.hp ? this.sides.p1.active : undefined;
		const ownSet = pokemon.find(set => set.active);
		const candidates: { choice: string, score: number }[] = [];
		const forced = !!request.forceSwitch;
		const active = forced ? undefined : request.active?.[0];
		const activeOwn = ownSet && this.own(ownSet, true);
		if (active && activeOwn && ownSet) {
			const max = active.maxMoves?.maxMoves;
			const alreadyMax = max && !active.canDynamax;
			const options = alreadyMax ? max : active.moves;
			for (const [i, option] of options.entries()) {
				const original = dex.moves.get(active.moves[i]?.id || option.move);
				const move = alreadyMax ? dex.moves.get(option.move) : original;
				const power = alreadyMax ? original.maxMove?.basePower : undefined;
				const choice = `move ${i + 1}`;
				const score = !foe ? this.random() : this.score(alreadyMax ?
					{ ...move, category: original.category, priority: 0 } : move, activeOwn, foe, power);
				if (!option.disabled) candidates.push({ choice, score });
				if (!foe || alreadyMax) continue;
				const z = active.canZMove?.[i];
				if (z && original.category !== 'Status') {
					const zMove = dex.moves.get(z.move);
					const zScore = this.score({ ...zMove, category: original.category }, activeOwn, foe,
						zMove.basePower > 1 ? zMove.basePower : original.zMove?.basePower || 150);
					candidates.push({ choice: choice + ' zmove', score: zScore - 0.13 });
				}
				if (option.disabled) continue;
				if (active.canMegaEvo || active.canMegaEvoX || active.canMegaEvoY) {
					const mega = dex.items.get(activeOwn.item).megaStone?.[activeOwn.species];
					const evolved = mega ? {
						...activeOwn, species: mega, types: undefined, stats: undefined,
						ability: toID(dex.species.get(mega).abilities[0]),
					} : activeOwn;
					const mechanic = active.canMegaEvoX ? 'megax' : active.canMegaEvoY ? 'megay' : 'mega';
					candidates.push({ choice: choice + ' ' + mechanic, score: this.score(move, evolved, foe) + 0.37 });
				}
				const hasSignature = active.canMegaEvo || active.canMegaEvoX || active.canMegaEvoY || active.canZMove;
				if (active.canTerastallize && !hasSignature) {
					const tera = { ...activeOwn, tera: active.canTerastallize };
					const defensiveGain = Math.max(0, this.threat(foe, activeOwn) - this.threat(foe, tera));
					candidates.push({ choice: choice + ' terastallize',
						score: this.score(move, tera, foe) + defensiveGain * 1.2 - 0.19 });
				}
				if (active.canDynamax && max?.[i] && !max[i].disabled && move.category !== 'Status' && !hasSignature) {
					const maxMove = { ...dex.moves.get(max[i].move), category: move.category, priority: 0 };
					const maxScore = this.score(maxMove, activeOwn, foe, move.maxMove?.basePower || 100);
					const danger = this.threat(foe, activeOwn) > activeOwn.hp ? 0.22 : 0;
					const gmaxBonus = active.maxMoves?.gigantamax ? 0.12 : 0;
					candidates.push({ choice: choice + ' dynamax', score: maxScore + danger + gmaxBonus - 0.24 });
				}
			}
		}
		if (forced || (active && !active.trapped && !active.maybeTrapped && this.turn > this.lastSwitch + 1)) {
			for (const [index, set] of pokemon.entries()) {
				if (set.active || !!hpFraction(set.condition) === !!ownSet?.reviving) continue;
				const next = this.own(set, false);
				const entryCost = this.entryDamage(next);
				const score = !foe ? 0 : this.threat(next, foe) * 1.6 - this.threat(foe, next) * 1.2 +
					(this.speed(next) > this.speed(foe) ? 0.1 : 0);
				const currentDanger = foe && activeOwn ? this.threat(foe, activeOwn) : 0;
				candidates.push({ choice: `switch ${index + 1}`, score: score - entryCost * 2 + next.hp * 0.15 +
					(currentDanger > (activeOwn?.hp || 1) ? 0.28 : -0.18) });
			}
		}
		const ranked = candidates.map(candidate => ({ ...candidate, score: candidate.score + this.random() * 0.12 }));
		ranked.sort((a, b) => b.score - a.score);
		const best = ranked[0]?.choice || 'default';
		if (best.startsWith('switch ')) this.lastSwitch = this.turn;
		return best;
	}
}
