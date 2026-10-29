/** Single-process deployment settings for Copa Rinha on Render Free. */
import type { ConfigType } from './config-loader';

export function applyRenderConfig(
	config: ConfigType, processTypes: readonly string[], env: NodeJS.ProcessEnv = process.env
) {
	if (env.RENDER !== 'true') return;

	const port = Number(env.PORT || 10000);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new RangeError('Render PORT must be an integer between 1 and 65535.');
	}

	Object.assign(config, {
		subprocesses: 0,
		port,
		bindaddress: '0.0.0.0',
		// Render terminates HTTPS/WSS at its proxy; the backend uses HTTP/WS.
		ssl: null,
		lazysockets: false,
		repl: false,
		watchconfig: false,
		// Copa Rinha uses local nicknames, without a login server or assertions.
		noguestsecurity: true,
	});
	// Legacy settings otherwise override subprocesses when the loader builds its cache.
	delete config.workers;
	for (const processType of processTypes) {
		delete config[`${processType}processes`];
	}
}
