'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Teams } = require('../../dist/sim/teams');
const {
	prepareTeam, shareTeam, teamURL, handleTeamRequest, TeamInputError, TeamRateLimiter,
	FORMAT, CLIENT, MAX_TEAM_BYTES, allowTeamRead,
} = require('../../dist/server/copa-teams');
const fixture = () => ({
	name: 'Time de teste', format: FORMAT,
	packedTeam: Teams.pack([{
		name: 'Sparky', species: 'Pikachu', item: 'Pikanium Z', ability: 'Static', moves: ['Thunderbolt', 'Volt Tackle'],
		nature: 'Adamant', evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
		ivs: { hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 },
		teraType: 'Water', gigantamax: true, shiny: true, gender: 'M', level: 100, happiness: 255,
	}]),
});
function fakeStorage(objects = new Map()) {
	return {
		objects,
		async put(team) {
			assert(!objects.has(team.id), 'mock store is create-only');
			objects.set(team.id, JSON.stringify(team));
		},
		async get(id) { return objects.has(id) ? JSON.parse(objects.get(id)) : null; },
	};
}
function request(path, store, method = 'GET', origin = CLIENT, ip = 'test-read-ip') {
	return new Promise(resolve => {
		const headers = {};
		const handled = handleTeamRequest({ url: path, method, headers: { origin }, socket: { remoteAddress: ip } }, {
			setHeader(key, value) { headers[key] = value; },
			end(text) { resolve({ status: this.statusCode, headers, data: JSON.parse(text) }); },
		}, store);
		if (!handled) resolve({ handled: false });
	});
}

describe('Copa Rinha R2 team shares', () => {
	it('uses native import/pack/export and preserves the entire Pokemon build', () => {
		const team = prepareTeam(fixture());
		assert.equal(team.packedTeam, fixture().packedTeam);
		assert.equal(team.importText, Teams.export(Teams.unpack(team.packedTeam)));
		const imported = Teams.import(team.importText);
		assert(imported);
		assert.equal(Teams.pack(imported), team.packedTeam);
		assert.equal(imported[0].name, 'Sparky');
		assert.equal(imported[0].teraType, 'Water');
		assert.equal(imported[0].gigantamax, true);
		assert.equal(imported[0].shiny, true);
		assert.equal(imported[0].ivs.spa, 0);
	});
	it('accepts the existing canonical format aliases and keeps the canonical stored ID', () => {
		for (const format of ['Copa Rinha II', '[Gen 9] Copa Rinha II', 'gen9coparinhaii', FORMAT]) {
			assert.equal(prepareTeam({ ...fixture(), format }).format, FORMAT);
		}
	});
	it('rejects invalid, oversized, unknown and unrelated format data without reflecting it', () => {
		for (const input of [
			{ ...fixture(), packedTeam: '' }, { ...fixture(), packedTeam: 'x'.repeat(MAX_TEAM_BYTES + 1) },
			{ ...fixture(), format: 'gen9ou' }, { ...fixture(), format: FORMAT + '@@@+Pikachu' },
			{ ...fixture(), name: 'a'.repeat(101) }, { ...fixture(), name: 'bad\nname' },
			{ ...fixture(), packedTeam: Teams.pack([{ species: 'NotARealPokemon', moves: ['Tackle'] }]) },
			{ ...fixture(), packedTeam: Teams.pack([{ species: 'Pikachu', moves: ['NotARealMove'] }]) },
		]) assert.throws(() => prepareTeam(input), TeamInputError);
	});
	it('creates immutable random unique links and retrieves after replacing the storage instance', async () => {
		const first = fakeStorage();
		const shares = await Promise.all(Array.from({ length: 20 }, () => shareTeam(fixture(), first)));
		assert.equal(new Set(shares.map(team => team.id)).size, 20);
		const restarted = fakeStorage(first.objects); // External object storage survives server instance replacement.
		for (const team of shares) {
			assert.match(team.id, /^[A-Za-z0-9_-]{32}$/);
			assert.deepEqual(await restarted.get(team.id), team);
			assert.equal(teamURL(team.id), CLIENT + '/team.html?id=' + team.id);
			assert(!('ownerid' in team) && !('ip' in team) && !('password' in team));
		}
		await assert.rejects(first.put(shares[0]));
	});
	it('provides GET/CORS/error handling, rejects invalid IDs and returns only the approved data shape', async () => {
		const store = fakeStorage();
		const team = await shareTeam(fixture(), store);
		const success = await request('/copa-rinha/teams/' + team.id, store);
		assert.equal(success.status, 200);
		assert.equal(success.headers['Access-Control-Allow-Origin'], CLIENT);
		assert.equal(success.headers['Referrer-Policy'], 'no-referrer');
		assert.deepEqual(success.data, team);
		assert.equal((await request('/copa-rinha/teams/' + 'a'.repeat(32), store)).status, 404);
		assert.equal((await request('/copa-rinha/teams/../bad', store)).status, 400);
		assert.equal((await request('/copa-rinha/teams/' + team.id, store, 'POST')).status, 405);
		assert.equal((await request('/copa-rinha/teams/' + team.id, store, 'GET', 'https://other.example')).headers['Access-Control-Allow-Origin'], undefined);
		assert.equal((await request('/unrelated', store)).handled, false);
		const failing = await request('/copa-rinha/teams/' + team.id, { async get() { throw Error('DO_NOT_EXPOSE_SECRET'); } });
		assert.equal(failing.status, 503);
		assert(!JSON.stringify(failing).includes('DO_NOT_EXPOSE_SECRET'));
		store.objects.set(team.id, JSON.stringify({ ...team, credential: 'DO_NOT_EXPOSE_SECRET', importText: 'forged' }));
		const sanitized = await request('/copa-rinha/teams/' + team.id, store);
		assert.equal(sanitized.data.importText, team.importText);
		assert(!JSON.stringify(sanitized).includes('DO_NOT_EXPOSE_SECRET'));
	});
	it('bounds request counts and resets throttles without storing identifying data in R2', () => {
		const limiter = new TeamRateLimiter(2, 1000, 2);
		assert(limiter.allow('one', 1)); assert(limiter.allow('one', 2)); assert(!limiter.allow('one', 3));
		assert(limiter.allow('two', 4)); assert(!limiter.allow('three', 5));
		assert(limiter.allow('three', 1002));
	});
	it('uses create-only SDK writes under teams/, no expiration, and safe SDK failure diagnostics', () => {
		// This is an isolated SDK transport mock. There is no network or real R2 credential.
		const script = `
			const assert = require('node:assert/strict');
			const {S3Client} = require('@aws-sdk/client-s3');
			const objects = new Map(); const logs = []; const secret = 'DO_NOT_PRINT_AWS_REQUEST_OR_CREDENTIAL';
			console.warn = text => logs.push(text);
			let mode = 'ok';
			S3Client.prototype.send = async function (command) {
				if (mode === 'fail') throw Object.assign(Error(secret), {name:'AccessDenied', $metadata:{httpStatusCode:403}, $request:{headers:{Authorization:secret}}});
				assert.equal(command.input.Bucket, 'test-bucket');
				assert(command.input.Key.startsWith('teams/'));
				if (command.constructor.name === 'PutObjectCommand') {
					assert.equal(command.input.IfNoneMatch, '*'); assert.equal(command.input.Expires, undefined);
					assert.equal(command.input.ContentType, 'application/json');
					objects.set(command.input.Key, command.input.Body); return {};
				}
				assert.equal(command.constructor.name, 'GetObjectCommand');
				const text = objects.get(command.input.Key);
				if (!text) throw Object.assign(Error('missing'), {name:'NoSuchKey'});
				return {ContentLength:Buffer.byteLength(text), Body:{async transformToString() {return text;}}};
			};
			const {shareTeam,r2TeamStorage} = require('./dist/server/copa-teams');
			(async () => {
				const store = r2TeamStorage();
				const team = await shareTeam(${JSON.stringify(fixture())}, store);
				assert.equal((await store.get(team.id)).packedTeam, team.packedTeam);
				assert.equal(await store.get('z'.repeat(32)), null);
				mode = 'fail'; await assert.rejects(store.put(team)); await assert.rejects(store.get(team.id));
				assert(logs.some(line => line.includes('AccessDenied') && line.includes('403')));
				assert(!JSON.stringify(logs).includes(secret));
			})().catch(error => {console.error(error); process.exitCode = 1;});
		`;
		execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: {
			...process.env, R2_BUCKET: 'test-bucket', R2_ENDPOINT: 'https://r2.example.invalid',
			R2_ACCESS_KEY_ID: 'synthetic-test-key', R2_SECRET_ACCESS_KEY: 'synthetic-test-secret',
		}, stdio: 'pipe' });
	});
});

describe('Copa Rinha native teams protocol integration', () => {
	const plugin = require('../../dist/server/chat-plugins/teams');
	let previousMode;
	beforeEach(() => { previousMode = Config.copaRinhaSingleFormat; Config.copaRinhaSingleFormat = true; });
	afterEach(() => { Config.copaRinhaSingleFormat = previousMode; });
	it('allows confirmed local nicknames without pretending autoconfirmed ownership and rejects restricted users', () => {
		const conn = { user: { id: 'local', named: true, autoconfirmed: '', locked: false, semilocked: false }, popup() {} };
		assert.doesNotThrow(() => plugin.TeamsHandler.validateAccess(conn));
		conn.user.named = false;
		assert.throws(() => plugin.TeamsHandler.validateAccess(conn));
		conn.user.named = true; conn.user.locked = true;
		assert.throws(() => plugin.TeamsHandler.validateAccess(conn));
		conn.user.locked = false; conn.user.semilocked = true;
		assert.throws(() => plugin.TeamsHandler.validateAccess(conn));
	});
	it('keeps R2 IDs out of official account-team events, gives the correct URL and refuses mutable ownership commands', async () => {
		const sent = [], popups = [];
		const connection = { user: { id: 'local', named: true }, send: data => sent.push(data), popup: data => popups.push(data) };
		const context = { connection, user: connection.user, popupReply: text => popups.push(text) };
		const id = 'a'.repeat(32);
		const original = plugin.TeamsHandler.save;
		plugin.TeamsHandler.save = async () => ({ teamid: id, teamName: 'Example', privacy: null, url: teamURL(id), visibility: 'unlisted', immutable: true });
		try {
			await plugin.commands.teams.save.call(context, 'Example,' + FORMAT + ',1,Pikachu||||Thunderbolt', null, connection.user, connection, 'save');
		} finally {
			// This test restores its own isolated stub; there is no concurrent writer.
			// oxlint-disable-next-line ps/require-atomic-updates
			plugin.TeamsHandler.save = original;
		}
		assert.equal(sent.length, 1);
		assert(sent[0].startsWith('|queryresponse|copateamupload|'));
		assert(!sent.some(line => line.startsWith('|queryresponse|teamupload|')));
		const response = JSON.parse(sent[0].slice('|queryresponse|copateamupload|'.length));
		assert.equal(response.teamid, id); assert.equal(response.url, teamURL(id));
		assert.equal(response.visibility, 'unlisted'); assert.equal(response.privacy, null);
		assert(popups[0].includes(teamURL(id)) && !popups[0].includes('psim.us/t/'));
		for (const command of ['update', 'delete', 'setprivacy']) {
			const handler = command === 'update' ? plugin.commands.teams.save : plugin.commands.teams[command];
			await handler.call(context, id, null, connection.user, connection, command);
		}
		assert.equal(sent.length, 1);
		assert(popups.slice(1).every(text => text.includes('imutáve')));
	});
	it('renders the native upload page for the canonical format and keeps lists unlisted', () => {
		const connection = { user: { id: 'local', named: true } };
		const page = plugin.pages.teams.upload.call({ title: '', pageid: 'teams-upload', TL: s => s }, [], connection.user, connection);
		assert(page.includes('/teams save {name},{format},{privacy},{team}'));
		assert(page.includes('gen9coparinhaii'));
		assert(page.includes('não listado'));
	});
	it('shares the read throttle between HTTP and the native view page', async () => {
		const ip = 'native-http-shared-read-limit';
		for (let i = 0; i < 600; i++) assert(allowTeamRead(ip));
		const connection = { ip, user: { id: 'reader', named: true } };
		const id = 'Ab_-'.repeat(8);
		await assert.rejects(
			plugin.pages.teams.view.call({ title: '' }, [id], connection.user, connection),
			/Muitas solicitações/
		);
		const result = await request('/copa-rinha/teams/' + id, fakeStorage(), 'GET', CLIENT, ip);
		assert.equal(result.status, 429);
		assert.equal(result.headers['Retry-After'], '60');
	});
	it('returns a custom-only error event when a share fails without assigning an account ID', async () => {
		const sent = [], popups = [];
		const connection = { user: { id: 'local', named: true }, send: data => sent.push(data), popup: data => popups.push(data) };
		const context = { connection, user: connection.user, popupReply: text => popups.push(text) };
		const original = plugin.TeamsHandler.save;
		plugin.TeamsHandler.save = async () => null;
		try {
			await plugin.commands.teams.save.call(context, 'Example,' + FORMAT + ',0,Pikachu||||Thunderbolt', null, connection.user, connection, 'save');
		} finally {
			// This test restores its own isolated stub; there is no concurrent writer.
			// oxlint-disable-next-line ps/require-atomic-updates
			plugin.TeamsHandler.save = original;
		}
		assert.equal(sent.length, 1);
		assert(sent[0].startsWith('|queryresponse|copateamupload|'));
		const response = JSON.parse(sent[0].slice('|queryresponse|copateamupload|'.length));
		assert.equal(response.error, 'Compartilhamento não concluído.');
		assert.equal(response.teamid, undefined);
		assert.equal(response.requestTeam, 'Pikachu||||Thunderbolt');
	});
	it('outside Copa mode keeps the upstream PostgreSQL-disabled guard', () => {
		Config.copaRinhaSingleFormat = false;
		const conn = { user: { id: 'local', named: true } };
		assert.throws(() => plugin.TeamsHandler.validateAccess(conn), /database is currently disabled/);
	});
});
