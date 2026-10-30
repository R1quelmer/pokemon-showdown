'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { applyRenderConfig } = require('../../dist/server/coparinha-render');

const processTypes = [
	'localartemis', 'remoteartemis', 'battlesearch', 'datasearch', 'friends',
	'chatdb', 'pm', 'modlog', 'network', 'simulator', 'validator', 'verifier',
];

function localConfig() {
	return {
		subprocesses: { network: 2, simulator: 3, validator: 4 },
		port: 8000, bindaddress: '127.0.0.1', ssl: { port: 443 },
		repl: true, watchconfig: true, lazysockets: true,
		noguestsecurity: false, noipchecks: false, nothrottle: false,
		customsetting: 'preserved',
	};
}

// Exercise the real loader and its subprocess cache without modifying the
// server globals, local config file, or process environment used by other tests.
function loadConfig(config, env) {
	const renderModule = { exports: {} };
	const renderPath = path.resolve(__dirname, '../../dist/server/coparinha-render.js');
	vm.runInNewContext(fs.readFileSync(renderPath, 'utf8'), {
		module: renderModule, exports: renderModule.exports, process: { env },
	}, { filename: renderPath });

	const configPath = '/render/config/config.js';
	const loaderModule = { exports: {} };
	const isolatedGlobal = {};
	const loaderPath = path.resolve(__dirname, '../../dist/server/config-loader.js');
	vm.runInNewContext(fs.readFileSync(loaderPath, 'utf8'), {
		module: loaderModule,
		exports: loaderModule.exports,
		global: isolatedGlobal,
		process: { env, argv: [] },
		require(id) {
			if (id === '../config/config-example') return { routes: {}, grouplist: [] };
			if (id === '../lib') return { FS: () => ({ path: configPath }) };
			if (id === './coparinha-render') return renderModule.exports;
			if (id === configPath) return config;
			throw new Error(`Unexpected config-loader dependency: ${id}`);
		},
	}, { filename: loaderPath });
	return isolatedGlobal.Config;
}

describe('Copa Rinha Render configuration', () => {
	for (const render of [undefined, 'false', 'TRUE']) {
		it(`preserves the complete local configuration when RENDER is ${render}`, () => {
			const config = localConfig();
			const original = structuredClone(config);
			applyRenderConfig(config, processTypes, { RENDER: render, PORT: '10000' });
			assert.deepEqual(config, original);
		});
	}

	it('uses a single process and local nicknames only in the Copa Rinha Render preset', () => {
		const config = localConfig();
		applyRenderConfig(config, processTypes, { RENDER: 'true', PORT: '12345' });
		assert.equal(config.subprocesses, 0);
		assert.equal(config.port, 12345);
		assert.equal(config.bindaddress, '0.0.0.0');
		assert.equal(config.ssl, null);
		assert.equal(config.repl, false);
		assert.equal(config.watchconfig, false);
		assert.equal(config.lazysockets, false);
		assert.equal(config.noguestsecurity, true);
		assert.equal(config.copaRinhaSingleFormat, true);
		assert.equal(config.noipchecks, false);
		assert.equal(config.nothrottle, false);
		assert.equal(config.customsetting, 'preserved');
	});

	it('uses port 10000 when Render has not provided PORT', () => {
		const config = localConfig();
		applyRenderConfig(config, processTypes, { RENDER: 'true' });
		assert.equal(config.port, 10000);
	});

	for (const port of ['0', '-1', '65536', '10000.5', '10000oops', ' ']) {
		it(`rejects invalid Render PORT ${JSON.stringify(port)}`, () => {
			assert.throws(() => {
				applyRenderConfig(localConfig(), processTypes, { RENDER: 'true', PORT: port });
			}, RangeError);
		});
	}

	it('removes deprecated worker counts that could reenable subprocesses', () => {
		const config = localConfig();
		config.workers = 2;
		for (const type of processTypes) config[`${type}processes`] = 2;
		applyRenderConfig(config, processTypes, { RENDER: 'true', PORT: '10000' });
		assert.equal('workers' in config, false);
		for (const type of processTypes) assert.equal(`${type}processes` in config, false);
	});

	it('the real config loader caches zero for every process type despite legacy local overrides', () => {
		const local = localConfig();
		local.workers = 2;
		for (const type of processTypes) local[`${type}processes`] = 2;
		const config = loadConfig(local, { RENDER: 'true', PORT: '10000' });
		assert.equal(config.subprocesses, 0);
		assert.equal(config.port, 10000);
		assert.equal(config.bindaddress, '0.0.0.0');
		assert.equal(config.noguestsecurity, true);
		assert.equal(config.copaRinhaSingleFormat, true);
		assert.deepEqual(Object.keys(config.subprocessescache).sort(), [...processTypes].sort());
		for (const type of processTypes) assert.equal(config.subprocessescache[type], 0);
	});

	it('the real config loader preserves the ordinary local process counts outside Render', () => {
		const config = loadConfig(localConfig(), {});
		assert.equal(config.port, 8000);
		assert.equal(config.bindaddress, '127.0.0.1');
		assert.equal(config.noguestsecurity, false);
		assert.equal(config.subprocessescache.network, 2);
		assert.equal(config.subprocessescache.simulator, 3);
		assert.equal(config.subprocessescache.validator, 4);
	});
});
