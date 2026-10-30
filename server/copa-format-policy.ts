/** Public player battle policy; never restrict the simulator or team validator. */
export const COPA_FORMAT = 'gen9coparinhanationaldexza';
export const COPA_ONLY_MESSAGE = 'Este servidor utiliza exclusivamente o formato Copa Rinha II.';
export function playerFormatAllowed(format: string): boolean {
	if (!Config.copaRinhaSingleFormat) return true;
	// Resolve native names/aliases, but never authorize custom-rule variants.
	if (format.includes('@@@')) return false;
	const resolved = Dex.formats.get(format);
	return resolved.exists && resolved.id === COPA_FORMAT && !resolved.customRules?.length;
}
