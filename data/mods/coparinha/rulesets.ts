export const Rulesets: import('../../../sim/dex-formats').ModdedFormatDataTable = {
	coparinhamechanics: {
		effectType: 'ValidatorRule',
		name: 'Copa Rinha Mechanics',
		onBegin() {
			// Side's constructor defaults this to true outside Gen 8.
			for (const side of this.sides) side.dynamaxUsed = false;
		},
		onValidateSet(set) {
			const species = this.dex.species.get(set.species);
			const item = this.dex.items.get(set.item);
			if (species.isMega && species.gen >= 9 || item.megaStone &&
				Object.values(item.megaStone).some(mega => this.dex.species.get(mega).gen >= 9)) {
				return ['Megas de Legends Z-A não fazem parte deste protótipo.'];
			}
		},
	},
};
