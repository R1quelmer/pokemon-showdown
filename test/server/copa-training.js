'use strict';
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { makeUser } = require('../users-utils');
const { CopaTrainingAI } = require('../../dist/server/copa-training-ai');
const { buildTrainingTeams, getTrainingBuilds } = require('../../dist/server/copa-training-teams');
const { COPA_FORMAT } = require('../../dist/server/copa-format-policy');
const { saveBattle } = require('../../dist/server/copa-replays');
const { BattleReady } = require('../../dist/server/ladders-challenges');
const { copaAccounts, emptyRegistry } = require('../../dist/server/copa-accounts');
const common = require('../common');

const playerTeam = () => Teams.pack(Teams.import('Pikachu\nAbility: Static\nEVs: 252 SpA\n- Thunderbolt'));
async function until(test) {
	for (let i = 0; i < 200; i++) {
		if (test()) return;
		await delay(5);
	}
	assert.fail('Expected simulator state was not reached');
}

describe('Copa training', () => {
	it('matches real Copa accounts with each other and with official users before any bot fallback', async () => {
		const original = Config.copaRinhaSingleFormat, ipChecks = Config.noipchecks;
		const source = copaAccounts.source;
		let registry = emptyRegistry();
		copaAccounts.source = {
			async read() { return { value: structuredClone(registry) }; },
			async write(next) { registry = structuredClone(next); },
		};
		Config.copaRinhaSingleFormat = true;
		Config.noipchecks = false;
		const users = [], rooms = [];
		const makeLocal = async (name, ip, nonce) => {
			const session = await copaAccounts.authenticate('register', name, 'fixture matchmaking pass');
			const user = makeUser(undefined, ip);
			users.push(user);
			const connection = user.connections[0];
			connection.challenge = nonce.repeat(256);
			await copaAccounts.grant(session.token, '4|' + connection.challenge);
			await user.rename(name, 'copa', false, connection);
			assert(connection.hasCopaSession(user));
			assert.equal(user.registered, false);
			return user;
		};
		const search = async (user, format) => {
			user.battleSettings.team = playerTeam();
			await Chat.parse('/search ' + format, null, user, user.connections[0]);
		};
		try {
			const alice = await makeLocal('Copa Search Alice', '192.0.2.11', 'a');
			const bob = await makeLocal('Copa Search Bob', '192.0.2.12', 'b');
			const official = makeUser('Official Search', '192.0.2.13');
			users.push(official);
			assert.equal(alice.settings.allowLadderBots, false);
			await Chat.parse('/allowbots', null, alice, alice.connections[0]);
			await search(alice, 'gen9coparinhaii');
			assert(Ladders(COPA_FORMAT).hasSearch(alice));
			await search(bob, COPA_FORMAT);
			const pvp = Rooms.get([...alice.games][0]);
			assert(pvp && !pvp.battle.isTraining);
			rooms.push(pvp);
			assert(bob.games.has(pvp.roomid));
			assert(!Ladders(COPA_FORMAT).hasSearch(alice));
			assert(!Ladders(COPA_FORMAT).hasSearch(bob));
			await search(official, 'gen9coparinhaii');
			await search(alice, COPA_FORMAT);
			const mixed = Rooms.get([...official.games][0]);
			assert(mixed && !mixed.battle.isTraining);
			rooms.push(mixed);
			assert(alice.games.has(mixed.roomid));
			assert(!Ladders(COPA_FORMAT).hasSearch(official));
			// Reproduce a shared ingress address without disabling IP checks.
			bob.latestIp = official.latestIp;
			await search(bob, COPA_FORMAT);
			await search(official, COPA_FORMAT);
			const shared = [...bob.games].map(id => Rooms.get(id)).find(room => room && room !== pvp);
			assert(shared && official.games.has(shared.roomid));
			rooms.push(shared);
			assert.equal(shared.rated, 0);
		} finally {
			for (const room of rooms) room.destroy();
			for (const user of users) { user.disconnectAll(); user.destroy(); }
			copaAccounts.source = source;
			Config.copaRinhaSingleFormat = original;
			Config.noipchecks = ipChecks;
		}
	});

	it('cancels stale and in-flight searches, cleans up disconnects and respects bot opt-out', async () => {
		const original = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		const user = makeUser('Copa Waiting', '192.0.2.20');
		const connections = user.connections;
		const first = connections[0];
		const ladder = Ladders(COPA_FORMAT);
		const timers = [];
		const realTimeout = global.setTimeout;
		global.setTimeout = (callback, ms, ...args) => {
			const timer = realTimeout(callback, ms, ...args);
			if (ms >= 9990 && ms <= 10000) timers.push(() => { clearTimeout(timer); callback(...args); });
			return timer;
		};
		try {
			user.battleSettings.team = playerTeam();
			await Chat.parse('/search ' + COPA_FORMAT, null, user, first);
			assert(ladder.hasSearch(user));
			assert.equal(timers.length, 0);
			await Chat.parse('/cancelsearch gen9coparinhaii', null, user, first);
			assert(!ladder.hasSearch(user));
			let settle;
			let calls = 0;
			ladder.prepBattle = () => {
				calls++;
				return new Promise(resolve => { settle = resolve; });
			};
			const pending = ladder.searchBattle(user, first);
			await ladder.searchBattle(user, first);
			assert.equal(calls, 1);
			await Chat.parse('/cancelsearch', null, user, first);
			settle(new BattleReady(user.id, COPA_FORMAT, { team: playerTeam() }));
			await pending;
			assert(!ladder.hasSearch(user), 'validation cannot re-add a cancelled search');
			await Chat.parse('/allowbots', null, user, first);
			await Chat.parse('/search ' + COPA_FORMAT, null, user, first);
			assert.equal(timers.length, 1);
			await Chat.parse('/blockbots', null, user, first);
			timers.shift()();
			assert.equal(user.games.size, 0);
			assert(ladder.hasSearch(user));
			Ladders.cancelSearches(user);
			await Chat.parse('/allowbots', null, user, first);
			await Chat.parse('/search ' + COPA_FORMAT, null, user, first);
			assert(ladder.hasSearch(user));
			first.onDisconnect();
			assert(!ladder.hasSearch(user));
			timers.shift()();
			assert.equal(user.games.size, 0);
		} finally {
			global.setTimeout = realTimeout;
			user.disconnectAll();
			user.destroy();
			Config.copaRinhaSingleFormat = original;
		}
	});
	it('validates 166 builds and 32 curated six-member teams in the real format', () => {
		const builds = getTrainingBuilds();
		assert.equal(builds.size, 83);
		assert([...builds.values()].every(variants => variants.length === 2));
		const teams = buildTrainingTeams();
		assert.equal(teams.length, 32);
		assert.equal(new Set(teams.map(team => team.strategy)).size, 16);
		assert(teams.every(({ team }) => Teams.unpack(team).length === 6));
		assert.deepEqual(new Set(teams.flatMap(({ team }) => Teams.unpack(team).map(set => set.species))), new Set(builds.keys()));
	});

	function decision(foe, own, lines = [], changeRequest, checkResult) {
		const sim = common.createBattle({ formatid: COPA_FORMAT }, [foe, own]);
		try {
			sim.makeChoices('team 123456', 'team 123456');
			const ai = new CopaTrainingAI(() => 0);
			ai.observe([
				`|switch|p1a: Foe|${foe[0].species}, L100|100/100`,
				`|switch|p2a: Bot|${own[0].species}, L100|100/100`,
				...lines,
			]);
			const request = sim.p2.activeRequest;
			changeRequest?.(request);
			const choice = ai.choose(request);
			assert(sim.choose('p2', choice), choice);
			if (checkResult) {
				assert(sim.choose('p1', 'move 1'));
				checkResult(sim);
			}
			return choice;
		} finally {
			sim.destroy();
		}
	}
	const set = (species, moves, options = {}) => ({ species, moves, ...options });
	const disableGimmicks = request => Object.assign(request.active[0], {
		canDynamax: false, canTerastallize: null, maxMoves: null,
	});
	it('takes a public immunity into account and prioritizes a finishing move', () => {
		const own = [set('Luxray', ['Wild Charge', 'Crunch', 'Quick Attack'])];
		assert.equal(decision([set('Rotom-Wash', ['Surf'])], own,
			['|-ability|p1a: Foe|Volt Absorb'], disableGimmicks), 'move 2');
		const fastFoe = [set('Dragapult', ['Shadow Ball'])];
		assert.equal(decision(fastFoe, [set('Scizor', ['Bullet Punch', 'Iron Head'])],
			['|-damage|p1a: Foe|9/100'], disableGimmicks), 'move 1');
	});
	it('switches out of a bad matchup and avoids a second sleep under Sleep Clause', () => {
		const foe = [set('Garchomp', ['Earthquake'])];
		const bench = [set('Luxray', ['Wild Charge']), set('Glaceon', ['Ice Beam'])];
		assert.equal(decision(foe, bench, ['|move|p1a: Foe|Earthquake|p2a: Bot'], disableGimmicks), 'switch 2');
		assert.notEqual(decision(
			[set('Snorlax', ['Splash'])], [set('Breloom', ['Spore', 'Mach Punch'])],
			['|switch|p1a: Other|Clodsire|100/100 slp', '|switch|p1a: Foe|Snorlax|100/100'],
			disableGimmicks
		), 'move 1');
	});

	it('uses Mega, Z, Tera, Dynamax and G-Max through legal simulator requests', () => {
		const foe = [set('Blissey', ['Splash'])];
		assert.match(decision(foe, [set('Lucario', ['Close Combat'], { item: 'Lucarionite' })]), / mega$/);
		assert.match(decision(foe, [set('Lucario', ['Close Combat'], { item: 'Lucarionite Z' })]), / mega$/);
		assert.match(decision(foe, [set('Raichu-Alola', ['Thunderbolt'], { item: 'Aloraichium Z' })]), / zmove$/);
		assert.match(decision([set('Vaporeon', ['Surf'])],
			[set('Talonflame', ['Brave Bird'], { teraType: 'Grass' })],
			['|move|p1a: Foe|Surf|p2a: Bot'], request => { request.active[0].canDynamax = false; request.active[0].maxMoves = null; }),
		/ terastallize$/);
		assert.match(decision(foe, [set('Staraptor', ['Wing Attack'])]), / dynamax$/);
		assert.match(decision([set('Incineroar', ['Growl'])],
			[set('Blastoise', ['Water Pulse'], { gigantamax: true })], [], undefined,
			sim => assert(sim.log.some(line => line.includes('G-Max Cannonade')))
		), / dynamax$/);
	});

	it('keeps playing after an actual KO issues a forced replacement request', () => {
		const sim = common.createBattle({ formatid: COPA_FORMAT }, [
			[set('Mewtwo', ['Thunderbolt'])],
			[set('Dewott', ['Splash']), set('Swampert', ['Earthquake']), set('Glaceon', ['Ice Beam'])],
		]);
		try {
			sim.makeChoices('team 1', 'team 123');
			sim.p2.active[0].hp = 1;
			sim.makeChoices('move 1', 'move 1');
			assert(sim.p2.activeRequest.forceSwitch[0]);
			const ai = new CopaTrainingAI(() => 0);
			ai.observe(['|switch|p1a: Foe|Mewtwo|100/100', '|move|p1a: Foe|Thunderbolt|p2a: Bot']);
			const choice = ai.choose(sim.p2.activeRequest);
			assert.equal(choice, 'switch 2');
			assert(sim.choose('p2', choice));
			assert.equal(sim.p2.active[0].species.name, 'Swampert');
		} finally {
			sim.destroy();
		}
	});

	it('falls back after a queued search, respects capacity and releases reservations', async () => {
		const original = Config.copaRinhaSingleFormat, originalIpChecks = Config.noipchecks;
		Config.copaRinhaSingleFormat = true;
		Config.noipchecks = false;
		const players = ['Alice', 'Bob', 'Carla', 'Davi'].map(name => makeUser(`Treino ${name}`));
		const rooms = [];
		const command = async (user, team = playerTeam()) => {
			const connection = user.connections[0];
			user.settings.allowLadderBots = true;
			user.battleSettings.team = team;
			await Chat.parse('/search gen9coparinhaii', null, user, connection);
		};
		const timers = [];
		const realTimeout = global.setTimeout;
		global.setTimeout = (callback, ms, ...args) => {
			const timer = realTimeout(callback, ms, ...args);
			if (ms >= 9990 && ms <= 10000) timers.push(() => { clearTimeout(timer); callback(...args); });
			return timer;
		};
		const advance = () => timers.splice(0).forEach(callback => callback());
		const originalWarn = console.warn;
		console.warn = (...args) => { if (!String(args[0]).includes('Copa Rinha: falha no replay')) originalWarn(...args); };
		try {
			await command(players[0], 'not a packed team');
			assert.equal(players[0].games.size, 0);
			for (const player of players.slice(0, 3)) {
				await command(player);
				assert(Ladders(COPA_FORMAT).hasSearch(player) && !player.games.size);
				assert.equal(timers.length, 1);
				advance();
			}
			for (const user of players.slice(0, 3)) {
				const room = Rooms.get([...user.games][0]);
				assert(room, 'native command creates a room');
				rooms.push(room);
				assert.equal(room.rated, 0);
				assert.equal(room.battle.p2.name, 'Treinador [BOT]');
				assert.equal(room.battle.p2.getUser(), null);
				assert(room.settings.isPrivate);
			}
			const [first] = rooms;
			const game = first.battle;
			await command(players[3]);
			assert.equal(players[3].games.size, 0);
			advance();
			assert(Ladders(COPA_FORMAT).hasSearch(players[3]), 'capacity leaves the search in the human queue');
			assert.equal(players[0].games.size, 1);
			assert.equal(game.joinGame(players[3]), false);
			await until(() => game.p2.request.choice.startsWith('team'));
			game.choose(players[0], 'team 1');
			await until(() => game.turn === 1 && !!game.p2.request.choice);
			game.onLeave(players[0]);
			assert(game.trainingDisconnectTimer);
			game.onJoin(players[0]);
			assert.equal(game.trainingDisconnectTimer, undefined);
			game.choose(players[0], 'move 1');
			await until(() => game.turn > 1 || game.ended);
			if (!game.ended) assert(game.leaveGame(players[0]));
			await until(() => game.ended);
			assert.equal(game.trainingAI, undefined);
			assert.equal(players[0].games.size, 0);
			let saved;
			await saveBattle(game, game.logData?.winner || 'Treinador [BOT]', { async put(replay) { saved = replay; } });
			assert(saved.log.includes('|turn|1'));
			assert(saved.log.includes('Treinador [BOT]'));
			assert.equal(saved.visibility, 'private');
			advance();
			const replacement = Rooms.get([...players[3].games][0]);
			assert(replacement?.battle?.isTraining);
			rooms.push(replacement);
			// Capture the real grace-period callback without waiting a minute.
			const originalTimeout = global.setTimeout;
			let expire;
			global.setTimeout = (callback, ms, ...args) => {
				const timer = originalTimeout(callback, ms, ...args);
				if (ms === 60_000) expire = () => { clearTimeout(timer); callback(...args); };
				return timer;
			};
			try {
				replacement.battle.onLeave(players[3]);
			} finally {
				global.setTimeout = originalTimeout;
			}
			assert(expire);
			expire();
			await until(() => replacement.battle.ended);
			assert.equal(players[3].games.size, 0);
		} finally {
			for (const room of rooms) room.destroy();
			for (const player of players) { player.disconnectAll(); player.destroy(); }
			Config.copaRinhaSingleFormat = original;
			Config.noipchecks = originalIpChecks;
			global.setTimeout = realTimeout;
			console.warn = originalWarn;
		}
	});

	it('lists public battles and only the requester’s private training, with separate counts', async () => {
		const original = Config.copaRinhaSingleFormat;
		Config.copaRinhaSingleFormat = true;
		const [owner, other, viewer] = ['Trainer List Owner', 'Trainer List Other', 'Trainer List Viewer'].map(name => makeUser(name));
		const team = playerTeam();
		const rooms = [];
		const training = user => {
			const room = Rooms.createBattle({
				format: COPA_FORMAT, players: [{ user, team }], trainingTeam: team, challengeType: 'training',
				rated: false, isPrivate: 'hidden', allowRenames: false,
			});
			rooms.push(room);
			return room;
		};
		try {
			const own = training(owner), shared = training(other);
			const pvp = Rooms.createBattle({
				format: COPA_FORMAT, players: [{ user: owner, team }, { user: other, team }], rated: false,
			});
			rooms.push(pvp);
			await until(() => rooms.every(room => room.battle.started));
			const list = user => Chat.crqHandlers.copabattles.call({}, COPA_FORMAT, user, true);
			assert(!list(viewer).rooms[own.roomid]);
			assert(!list(viewer).rooms[shared.roomid]);
			assert.deepEqual(list(owner).rooms[own.roomid], {
				p1: owner.name, p2: 'Treinador [BOT]', training: true, private: true,
			});
			assert.deepEqual(list(owner).counts, { publicCount: 1, privateTrainingCount: 1 });
			await Chat.parse('/publicroom', shared, other, other.connections[0]);
			assert.equal(shared.settings.isPrivate, false, 'a player can explicitly make their training public');
			assert.deepEqual(list(viewer).rooms[shared.roomid], {
				p1: other.name, p2: 'Treinador [BOT]', training: true, private: false,
			});
			assert.deepEqual(list(viewer).counts, { publicCount: 2, privateTrainingCount: 0 });
			assert(!Rooms.global.getBattles(COPA_FORMAT)[own.roomid], 'native room list keeps its privacy semantics');
			pvp.setPrivate('hidden');
			assert(!list(owner).rooms[pvp.roomid], 'private human battles do not enter the directory');
			owner.leaveRoom(own, owner.connections[0]);
			assert(list(owner).rooms[own.roomid], 'private training remains discoverable during reconnect grace');
			owner.joinRoom(own, owner.connections[0]);
			assert(owner.inRooms.has(own.roomid));
			own.battle.forfeit(owner);
			await until(() => own.battle.ended);
			assert(!list(owner).rooms[own.roomid]);
		} finally {
			for (const room of rooms) room.destroy();
			for (const user of [owner, other, viewer]) { user.disconnectAll(); user.destroy(); }
			Config.copaRinhaSingleFormat = original;
		}
	});

	it('completes naturally without updating ladder rating', async () => {
		const user = makeUser('Treino Completo');
		const room = Rooms.createBattle({
			format: COPA_FORMAT, rated: false, isPrivate: 'hidden', challengeType: 'training',
			players: [{ user, team: Teams.pack(Teams.import('Zapdos @ Choice Specs\nEVs: 252 SpA\n- Thunderbolt')) }],
			trainingTeam: Teams.pack(Teams.import('Dewott\n- Water Gun')),
		});
		try {
			const game = room.battle;
			await until(() => game.p2.request.choice.startsWith('team'));
			game.choose(user, 'team 1');
			await until(() => game.turn === 1 && !!game.p2.request.choice);
			game.choose(user, 'move 1');
			await until(() => game.ended);
			assert.equal(room.rated, 0);
			assert.equal(game.endType, 'normal');
			assert(room.getLog(0).includes('|win|Treino Completo'));
			assert.equal(user.games.size, 0);
		} finally {
			room.destroy();
			user.disconnectAll();
			user.destroy();
		}
	});
});
