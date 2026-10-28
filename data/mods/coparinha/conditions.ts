export const Conditions: import('../../../sim/dex-conditions').ModdedConditionDataTable = {
	dynamax: {
		inherit: true,
		onStart(pokemon, source, effect) {
			this.dex.mod('gen9').conditions.get('dynamax').onStart!.call(this, pokemon, source, effect);
			pokemon.m.copaRinhaMechanic = 'dynamax';
			pokemon.canMegaEvo = null;
			pokemon.canUltraBurst = null;
			pokemon.canTerastallize = null;
		},
	},
};
