import { BattleActions } from '../../../sim/battle-actions';
import { Pokemon } from '../../../sim/pokemon';

/** Permanent per-Pokemon state: switching, Transform and Dynamax ending must not reset it. */
function useMechanic(pokemon: Pokemon, mechanic: string) {
	pokemon.m.copaRinhaMechanic = mechanic;
	pokemon.canMegaEvo = null;
	pokemon.canUltraBurst = null;
	pokemon.canTerastallize = null;
}

export const Scripts: ModdedBattleScriptsData = {
	inherit: 'gen9',
	gen: 9,
	init() {
		// Validation checks the prospective Mega forme for the G-Max flag. Retain
		// the base species' eligibility so a stone does not invalidate the set.
		for (const [id, species] of Object.entries(this.data.Pokedex)) {
			if (!species.forme?.includes('Mega') || (species.gen || 0) >= 9) continue;
			const gmax = this.data.Pokedex[this.toID(species.baseSpecies)].canGigantamax;
			if (gmax) this.modData('Pokedex', id).canGigantamax = gmax;
		}
	},
	side: {
		canDynamaxNow() {
			return !this.dynamaxUsed;
		},
	},
	pokemon: {
		getDynamaxRequest(this: Pokemon, skipChecks?: boolean) {
			if (!skipChecks && (
				this.m.copaRinhaMechanic || !this.side.canDynamaxNow() ||
				this.species.isMega || this.species.isPrimal || this.species.forme === 'Ultra' ||
				this.species.cannotDynamax || this.illusion?.species.cannotDynamax
			)) return;
			// Reuse Max Move/PP/G-Max generation without the base held-item exclusions.
			return Pokemon.prototype.getDynamaxRequest.call(this, true);
		},
	} as ModdedBattlePokemon & Pick<Pokemon, 'getDynamaxRequest'>,
	actions: {
		canMegaEvo(pokemon) {
			if (pokemon.m.copaRinhaMechanic) return null;
			const mega = BattleActions.prototype.canMegaEvo.call(this, pokemon);
			return mega && this.dex.species.get(mega).gen < 9 ? mega : null;
		},
		canTerastallize(pokemon) {
			return pokemon.m.copaRinhaMechanic ? null : pokemon.teraType;
		},
		canZMove(pokemon) {
			if (pokemon.m.copaRinhaMechanic) return;
			return BattleActions.prototype.canZMove.call(this, pokemon);
		},
		getZMove(move, pokemon, skipChecks) {
			if (pokemon.m.copaRinhaMechanic) return;
			return BattleActions.prototype.getZMove.call(this, move, pokemon, skipChecks);
		},
		runMegaEvo(pokemon) {
			if (pokemon.m.copaRinhaMechanic) return false;
			const result = BattleActions.prototype.runMegaEvo.call(this, pokemon);
			if (result) useMechanic(pokemon, 'mega');
			return result;
		},
		terastallize(pokemon) {
			if (pokemon.m.copaRinhaMechanic) return;
			BattleActions.prototype.terastallize.call(this, pokemon);
			if (pokemon.terastallized) useMechanic(pokemon, 'tera');
		},
		runMove(move, pokemon, targetLoc, options) {
			const usedZ = pokemon.side.zMoveUsed;
			BattleActions.prototype.runMove.call(this, move, pokemon, targetLoc, options);
			// A Z-Move stopped before activation (e.g. sleep) consumes neither allowance.
			if (!usedZ && pokemon.side.zMoveUsed) useMechanic(pokemon, 'zmove');
		},
	},
};
