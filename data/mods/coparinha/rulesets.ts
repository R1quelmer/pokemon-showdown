import { Pokedex } from '../../pokedex';
import { Species } from '../../../sim/dex-species';

// Reuse the upstream data without changing its Future/National Dex status globally.
// Species also infers Gen 9 for formes whose generation is implicit in their base species number.
const zaMegas = Object.values(Pokedex).filter(species => species.forme?.includes('Mega'))
	.map(species => new Species(species)).filter(species => species.gen === 9);
const zaUnbans = [...new Set(zaMegas.flatMap(species => [
	species.name, species.requiredItem!,
	...(typeof species.battleOnly === 'string' ? [species.battleOnly] : species.battleOnly || []),
]))];

export const Rulesets: import('../../../sim/dex-formats').ModdedFormatDataTable = {
	coparinhamechanics: {
		effectType: 'ValidatorRule',
		name: 'Copa Rinha Mechanics',
		unbanlist: zaUnbans,
		onBegin() {
			// Side's constructor defaults this to true outside Gen 8.
			for (const side of this.sides) side.dynamaxUsed = false;
		},
	},
};
