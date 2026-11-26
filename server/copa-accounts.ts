/** Copa-only accounts. Passwords/tokens never enter Showdown chat or its assertion namespace. */
import { randomBytes, createHash, scrypt as derive, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Dex } from '../sim/dex';
import { CLIENT } from './copa-replays';
const scrypt = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
	derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, value) => {
		if (error)
			reject(error);
		else
			resolve(value);
	});
});
const DAY = 86400000;
const LEGACY_REGISTRATION_DATE = '2026-11-24T03:00:00.000Z';
const registryKey = 'copa-accounts/v1/registry.json';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
interface Partner { species: string; shiny: boolean }
export const PROFILE_REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Hisui', 'Paldea'] as const;
type ProfileRegion = typeof PROFILE_REGIONS[number];
interface TrainerCompetition {
	region: ProfileRegion | '';
	dreamTeam: (Partner | null)[];
}
interface TrainerCard extends TrainerCompetition {
	bio: string;
	banner: string;
}
interface BattleStats { total: number; wins: number; losses: number }
interface Account {
	name: string;
	password: string | null;
	disabled?: boolean;
	avatar?: string;
	partner?: Partner;
	nicknameColor?: NicknameColor;
	registeredAt?: string;
	registrationDateRetroactive?: true;
	trainerCard?: TrainerCard;
	badges?: ProfileRegion[];
	achievements?: string[];
	titles?: string[];
	battleStats?: BattleStats;
}
const NICKNAME_COLORS = ['cyan', 'mint', 'pink', 'lilac', 'peach'] as const;
type NicknameColor = typeof NICKNAME_COLORS[number];
function publicNickname(account: Account) {
	return {
		nicknameColor: account.nicknameColor, badges: account.badges || [],
		goldNickname: PROFILE_REGIONS.every(region => account.badges?.includes(region)),
	};
}
interface PublicMember extends ReturnType<typeof publicNickname> {
	id: ID; name: string; avatar: string; partner?: Partner;
}
interface Session {
	id: string;
	expires: number;
}
interface Grant extends Session {
	session: string;
}
interface Registry {
	version: 1;
	accounts: Record<string, Account>;
	sessions: Record<string, Session>;
	grants: Record<string, Grant>;
	recoveries: Record<string, Session>;
}
export interface AccountStore {
	read(): Promise<{
		value: Registry,
		etag?: string,
	}>;
	write(value: Registry, etag?: string): Promise<void>;
}
export class AccountError extends Error {
	status: number;
	constructor(status: number, message: string) { super(message); this.status = status; }
}
export function emptyRegistry(): Registry {
	return { version: 1,
		accounts: { riquelme: { name: 'Riquelme', password: null } },
		sessions: {}, grants: {}, recoveries: {} };
}
let store: AccountStore | undefined;
function storage(): AccountStore {
	if (store)
		return store;
	const {
		R2_ENDPOINT: endpoint, R2_BUCKET: bucket,
		R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey,
	} = process.env;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
		throw new AccountError(503, 'Contas temporariamente indisponíveis.');
	const client = new S3Client({ region: 'auto', endpoint,
		credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
	return (store = {
		async read() {
			try {
				const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: registryKey }));
				if (!result.Body || (result.ContentLength || 0) > 2 * 1024 * 1024)
					throw new Error('Invalid account registry');
				const body = await result.Body.transformToString();
				if (Buffer.byteLength(body) > 2 * 1024 * 1024)
					throw new Error('Invalid account registry');
				const value = JSON.parse(body);
				if (value.version !== 1 || !value.accounts || !value.sessions || !value.grants || !value.recoveries || !result.ETag)
					throw new Error('Invalid account registry');
				return { value, etag: result.ETag };
			} catch (error: any) {
				if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404)
					return { value: emptyRegistry() };
				throw new AccountError(503, 'Contas temporariamente indisponíveis.');
			}
		},
		async write(value, etag) {
			await client.send(new PutObjectCommand({ Bucket: bucket, Key: registryKey, Body: JSON.stringify(value),
				ContentType: 'application/json', ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }) }));
		},
	});
}
function nameOf(value: unknown) {
	if (typeof value !== 'string' ||
		!/^[a-zA-Z0-9 ]{1,18}$/.test(value.trim()) ||
		!/[a-zA-Z]/.test(value) ||
		/^guest/i.test(value))
		throw new AccountError(400, 'Nickname inválido.');
	const name = value.trim().replace(/ +/g, ' ');
	const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (['__proto__', 'constructor', 'prototype'].includes(id))
		throw new AccountError(400, 'Nickname inválido.');
	return { name, id };
}
function isProfileRegion(value: unknown): value is ProfileRegion {
	return PROFILE_REGIONS.some(region => region === value);
}
function validTrainerBanner(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 6800) return false;
	if (!value) return true;
	const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
	if (!match) return false;
	const bytes = Buffer.from(match[1], 'base64');
	if (bytes.length < 16 || bytes.toString('base64') !== match[1] ||
		bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
	for (let i = 2; i + 9 < bytes.length;) {
		if (bytes[i] !== 0xff) return false;
		const marker = bytes[i + 1], length = bytes.readUInt16BE(i + 2);
		if (length < 2 || i + length + 2 > bytes.length) return false;
		if (marker === 0xc0 || marker === 0xc2) {
			return length >= 8 && bytes.readUInt16BE(i + 5) === 180 && bytes.readUInt16BE(i + 7) === 480;
		}
		i += length + 2;
	}
	return false;
}
function isTrainerSpecies(species: ReturnType<typeof Dex.species.get>) {
	return species.exists && species.num > 0 && species.isNonstandard !== 'CAP' &&
		species.isNonstandard !== 'Custom' && !species.tags?.includes('Pokestar');
}
let trainerSpeciesCatalog: { id: string; name: string; sprite: string }[] | undefined;
function getTrainerSpeciesCatalog() {
	if (trainerSpeciesCatalog) return trainerSpeciesCatalog;
	const dex = Dex.mod('coparinha');
	const entries = new Map<string, { id: string; name: string; sprite: string }>();
	for (const base of dex.species.all()) {
		for (const name of [base.name, ...base.cosmeticFormes || []]) {
			const species = dex.species.get(name);
			if (isTrainerSpecies(species)) {
				entries.set(species.id, { id: species.id, name: species.name, sprite: species.spriteid });
			}
		}
	}
	return (trainerSpeciesCatalog = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)));
}
function profilePokemon(input: unknown): Partner {
	const data = input as Partial<Partner> | undefined;
	if (typeof data?.species !== 'string' || !/^[a-z0-9]{1,32}$/.test(data.species) || typeof data.shiny !== 'boolean') {
		throw new AccountError(400, 'Pokémon inválido.');
	}
	const species = Dex.mod('coparinha').species.get(data.species);
	if (!isTrainerSpecies(species) || species.id !== data.species) {
		throw new AccountError(400, 'Escolha uma espécie ou forma do National Dex.');
	}
	return { species: species.id, shiny: data.shiny };
}
function trainerLabels(input: unknown): string[] {
	if (!Array.isArray(input) || input.length > 12 || !input.every(label =>
		typeof label === 'string' && label.trim() && label.length <= 80 && !/[\x00-\x1f\x7f]/.test(label))) {
		throw new AccountError(400, 'Informe até 12 conquistas ou títulos de até 80 caracteres cada.');
	}
	return [...new Set(input.map(label => label.trim()))];
}

let deriving = 0;
async function passwordHash(password: unknown, salt = randomBytes(16).toString('hex')) {
	if (typeof password !== 'string' || password.length < 10 || password.length > 128)
		throw new AccountError(400, 'Use uma senha exclusiva da Copa Rinha com 10 a 128 caracteres.');
	if (deriving >= 2)
		throw new AccountError(429, 'Muitas tentativas. Aguarde.');
	deriving++;
	try {
		const value = await scrypt(password, salt);
		return `scrypt$32768$8$3$${salt}$${value.toString('hex')}`;
	} finally {
		deriving--;
	}
}
async function matches(password: unknown, stored: string | null) {
	const salt = stored?.split('$')[4] || '00000000000000000000000000000000';
	const candidate = await passwordHash(password, salt);
	const expected = stored || 'x'.repeat(candidate.length);
	return expected.length === candidate.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
export class CopaAccounts {
	private source?: AccountStore;
	private now: () => number;
	private memberCache?: { expires: number, result: Promise<PublicMember[]> };
	constructor(source?: AccountStore, now = () => Date.now()) { this.source = source; this.now = now; }
	private async read() {
		const source = this.source || storage();
		for (let attempt = 0; attempt < 6; attempt++) {
			const snapshot = await source.read();
			const { value, etag } = snapshot;
			const legacy = Object.values(value.accounts).filter(account => account.password && !account.registeredAt);
			if (!legacy.length) return snapshot;
			for (const account of legacy) {
				account.registeredAt = LEGACY_REGISTRATION_DATE;
				account.registrationDateRetroactive = true;
			}
			if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
				throw new AccountError(503, 'Registro de contas cheio.');
			try {
				await source.write(value, etag);
			} catch (error: any) {
				if (![409, 412].includes(error.$metadata?.httpStatusCode))
					throw new AccountError(503, 'Contas temporariamente indisponíveis.');
			}
			// Reload the ETag before handing the migrated registry to a caller that may write it.
		}
		throw new AccountError(409, 'Outra alteração está em andamento. Tente novamente.');
	}
	private async change<T>(operation: (value: Registry) => T, changesMembers = false, pruneExpired = true): Promise<T> {
		for (let attempt = 0; attempt < 6; attempt++) {
			const { value, etag } = await this.read();
			const now = this.now();
			for (const table of pruneExpired ? [value.sessions, value.grants, value.recoveries] : []) {
				for (const [id, session] of Object.entries(table))
					if (session.expires <= now)
						delete table[id];
			}
			const result = operation(value);
			if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
				throw new AccountError(503, 'Registro de contas cheio.');
			try {
				await (this.source || storage()).write(value, etag);
				if (changesMembers) this.memberCache = undefined;
				return result;
			} catch (error: any) {
				if (![409, 412].includes(error.$metadata?.httpStatusCode))
					throw new AccountError(503, 'Contas temporariamente indisponíveis.');
			}
		}
		throw new AccountError(409, 'Outra alteração está em andamento. Tente novamente.');
	}
	publicMembers() {
		if (this.memberCache && this.memberCache.expires > this.now()) return this.memberCache.result;
		const result = this.read().then(({ value }) => Object.entries(value.accounts)
			.filter(([, account]) => account.password && !account.disabled)
			.map(([id, account]) => ({
				id: id as ID, name: account.name, avatar: account.avatar || 'unknown', partner: account.partner, ...publicNickname(account),
			})));
		this.memberCache = { expires: this.now() + 30000, result };
		return result;
	}
	async setAvatar(proof: Grant, avatar: string) {
		await this.change(value => {
			const session = value.sessions[proof.session];
			const account = value.accounts[proof.id];
			if (session?.id !== proof.id || session.expires <= this.now() || proof.expires <= this.now() ||
				!account?.password || account.disabled) {
				throw new AccountError(401, 'Sessão inválida ou expirada.');
			}
			account.avatar = avatar;
		}, true);
	}
	async setPartner(token: unknown, input: unknown) {
		const partner = input === null ? undefined : profilePokemon(input);
		return this.change(value => {
			const session = this.session(value, token);
			const account = value.accounts[session.id];
			account.partner = partner;
			return { partner: account.partner || null };
		}, true);
	}
	async setNicknameColor(token: unknown, choice: unknown) {
		const color = NICKNAME_COLORS.find(entry => entry === choice);
		if (choice !== null && !color) throw new AccountError(400, 'Cor de nickname inválida.');
		return this.change(value => {
			const session = this.session(value, token);
			const account = value.accounts[session.id];
			account.nicknameColor = color;
			return { nicknameColor: color || null };
		}, true, false);
	}
	async trainer(name: unknown) {
		const { id } = nameOf(name);
		const { value } = await this.read();
		const account = value.accounts[id];
		if (!account?.password || account.disabled) return null;
		return {
			name: account.name, avatar: account.avatar || 'unknown', partner: account.partner,
			registeredAt: account.registeredAt, card: account.trainerCard, ...publicNickname(account),
			achievements: account.achievements || [], titles: account.titles || [],
			stats: account.battleStats,
			online: global.Users?.getExact(id)?.connections.some(connection =>
				connection.user && connection.hasCopaSession(connection.user)) || false,
		};
	}
	async setTrainer(token: unknown, input: unknown) {
		const data = input as Pick<TrainerCard, 'bio' | 'banner'> | undefined;
		if (typeof data?.bio !== 'string' || data.bio.length > 360 || !validTrainerBanner(data.banner)) {
			throw new AccountError(400, 'Perfil inválido. Use uma imagem leve e até 360 caracteres na biografia.');
		}
		return this.change(value => {
			const session = this.session(value, token);
			const account = value.accounts[session.id];
			const card: TrainerCard = {
				region: account.trainerCard?.region || '', dreamTeam: account.trainerCard?.dreamTeam || Array(6).fill(null),
				bio: data.bio.trim(), banner: data.banner,
			};
			account.trainerCard = card;
			return { card };
		}, false, false);
	}
	private async adminTrainer(action: string, name: unknown, input: unknown) {
		const { id } = nameOf(name);
		if (action === 'get-trainer') {
			const { value } = await this.read();
			const account = value.accounts[id];
			if (!account?.password) throw new AccountError(404, 'Conta registrada não encontrada.');
			return { profile: {
				name: account.name, region: account.trainerCard?.region || '',
				dreamTeam: account.trainerCard?.dreamTeam || Array(6).fill(null),
				badges: account.badges || [], achievements: account.achievements || [], titles: account.titles || [],
			} };
		}
		const data = input as (Partial<TrainerCompetition> & {
			badges?: unknown; achievements?: unknown; titles?: unknown;
		}) | undefined;
		if (!data || (data.region !== '' && !isProfileRegion(data.region)) ||
			!Array.isArray(data.dreamTeam) || data.dreamTeam.length !== 6 ||
			!Array.isArray(data.badges) || data.badges.length > PROFILE_REGIONS.length || !data.badges.every(isProfileRegion)) {
			throw new AccountError(400, 'Confira a região de origem, o Hall da Fama e as regiões concluídas.');
		}
		const region = data.region;
		const dreamTeam = data.dreamTeam.map(slot => {
			if (slot === null) return null;
			const species = typeof slot?.species === 'string' && slot.species.length <= 48 ? toID(slot.species) : '';
			return profilePokemon({ species, shiny: slot?.shiny });
		});
		const selected = new Set(data.badges);
		const achievements = trainerLabels(data.achievements);
		const titles = trainerLabels(data.titles);
		return this.change(value => {
			const account = value.accounts[id];
			if (!account?.password) throw new AccountError(404, 'Conta registrada não encontrada.');
			account.trainerCard = { bio: '', banner: '', ...account.trainerCard, region, dreamTeam };
			account.badges = PROFILE_REGIONS.filter(item => selected.has(item));
			account.achievements = achievements;
			account.titles = titles;
			return { success: true };
		}, true, false);
	}

	async recordTrainerBattle(players: readonly { id: ID; account: ID | undefined }[], winner: ID) {
		if (!players.some(player => player.account)) return;
		await this.change(value => {
			for (const player of players) {
				const account = player.account && value.accounts[player.account];
				if (!account || !account.password || account.disabled) continue;
				const stats = account.battleStats ||= { total: 0, wins: 0, losses: 0 };
				stats.total++;
				if (winner === player.id) stats.wins++;
				else if (winner) stats.losses++;
			}
		});
	}

	private session(value: Registry, token: unknown) {
		if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
			throw new AccountError(401, 'Sessão inválida ou expirada.');
		const session = value.sessions[hash(token)];
		if (!session ||
			session.expires <= this.now() ||
			!value.accounts[session.id]?.password ||
			value.accounts[session.id].disabled)
			throw new AccountError(401, 'Sessão inválida ou expirada.');
		return session;
	}
	private issue(value: Registry, id: string) {
		if (Object.keys(value.sessions).length >= 4096)
			throw new AccountError(429, 'Limite de sessões atingido.');
		const token = secret(), expires = this.now() + 30 * DAY;
		value.sessions[hash(token)] = { id, expires };
		return { name: value.accounts[id].name, token, expires };
	}
	async authenticate(action: string, name: unknown, password: unknown) {
		const user = nameOf(name);
		if (global.Users?.isTrusted(user.id as ID))
			throw new AccountError(403, 'Nome protegido pelo servidor oficial.');
		if (action === 'register') {
			if (global.Users?.getExact(user.id)?.connected) throw new AccountError(409, 'Nickname em uso.');
			const encoded = await passwordHash(password);
			return this.change(value => {
				if (Object.hasOwn(value.accounts, user.id))
					throw new AccountError(409, 'Nickname registrado ou reservado.');
				if (Object.keys(value.accounts).length >= 1000)
					throw new AccountError(503, 'Limite de contas atingido.');
				value.accounts[user.id] = { name: user.name, password: encoded, registeredAt: new Date(this.now()).toISOString() };
				return this.issue(value, user.id);
			}, true);
		}
		const { value } = await this.read();
		const account = Object.hasOwn(value.accounts, user.id) ? value.accounts[user.id] : undefined;
		if (!await matches(password, account?.password || null) || !account || account.disabled)
			throw new AccountError(401, 'Nickname ou senha incorretos.');
		const expected = account.password;
		return this.change(current => {
			if (current.accounts[user.id]?.password !== expected || current.accounts[user.id].disabled)
				throw new AccountError(401, 'Nickname ou senha incorretos.');
			return this.issue(current, user.id);
		});
	}
	async grant(token: unknown, challenge: unknown) {
		if (typeof challenge !== 'string' || !/^\d+\|[a-f0-9]{256}$/i.test(challenge))
			throw new AccountError(400, 'Conexão inválida.');
		return this.change(value => {
			const session = this.session(value, token);
			value.grants[hash(challenge.split('|')[1])] = {
				...session, expires: this.now() + 30000,
				session: hash(token as string) };
			return { name: value.accounts[session.id].name, expires: session.expires };
		});
	}
	async consume(challenge: string, id: string) {
		return this.change(value => {
			const grant = value.grants[hash(challenge)];
			if (!grant ||
				grant.id !== id ||
				grant.expires <= this.now() ||
				!value.sessions[grant.session] ||
				value.sessions[grant.session].expires <= this.now() ||
				value.accounts[id]?.disabled)
				throw new AccountError(401, 'Identificação local inválida.');
			delete value.grants[hash(challenge)];
			return {
				id, session: grant.session, expires: value.sessions[grant.session].expires, avatar: value.accounts[id]?.avatar,
			};
		});
	}
	async protectedName(id: string) { return Object.hasOwn((await this.read()).value.accounts, id); }
	async logout(token: unknown) {
		const result = await this.change(value => {
			this.session(value, token);
			const session = hash(token as string);
			delete value.sessions[session];
			for (const [id, grant] of Object.entries(value.grants))
				if (grant.session === session)
					delete value.grants[id];
			return { success: true };
		});
		revokeLive(undefined, hash(token as string));
		return result;
	}
	async validSessions() { return (await this.read()).value; }
	async admin(action: string, names: unknown, regions?: unknown) {
		if (action === 'trainer-species') return { species: getTrainerSpeciesCatalog() };
		if (action === 'get-trainer' || action === 'save-trainer') return this.adminTrainer(action, names, regions);
		if (action === 'list') {
			const { value } = await this.read();
			return { accounts: Object.entries(value.accounts).map(([id, account]) => ({
				id, name: account.name,
				registered: !!account.password, disabled: !!account.disabled, badges: account.badges || [],
				sessions: Object.values(value.sessions)
					.filter(session => session.id === id && session.expires > this.now()).length })) };
		}
		if (!Array.isArray(names) || !names.length || names.length > 100)
			throw new AccountError(400, 'Informe de 1 a 100 nicknames.');
		const users = names.map(nameOf);
		const badgeAction = action === 'award-badge' || action === 'remove-badge';
		const selected = Array.isArray(regions) ? regions : [regions];
		if (badgeAction && (!selected.length || selected.length > PROFILE_REGIONS.length ||
			!selected.every(isProfileRegion))) {
			throw new AccountError(400, 'Selecione uma ou mais regiões válidas.');
		}
		const recovery = secret();
		const result = await this.change(value => {
			for (const user of users) {
				const account = Object.hasOwn(value.accounts, user.id) ? value.accounts[user.id] : undefined;
				if (action === 'reserve') {
					if (!account)
						value.accounts[user.id] = { name: user.name, password: null };
				} else if (action === 'release') {
					if (account?.password)
						throw new AccountError(409, 'Contas registradas são permanentes. Use desativar.');
					delete value.accounts[user.id];
				} else if (badgeAction) {
					if (!account?.password) throw new AccountError(404, 'Conta registrada não encontrada.');
					const badges = new Set(account.badges);
					for (const region of selected) {
						if (action === 'award-badge') badges.add(region);
						else badges.delete(region);
					}
					account.badges = PROFILE_REGIONS.filter(item => badges.has(item));
				} else if (action === 'disable' || action === 'enable') {
					if (!account)
						throw new AccountError(404, 'Conta não encontrada.');
					account.disabled = action === 'disable';
				} else if (action === 'recover' && users.length === 1 && account) {
					for (const [key, session] of Object.entries(value.recoveries))
						if (session.id === user.id)
							delete value.recoveries[key];
					value.recoveries[hash(recovery)] = { id: user.id, expires: this.now() + DAY };
					account.disabled = true;
				} else
					throw new AccountError(400, 'Ação inválida.');
				if (action === 'disable' || action === 'recover') {
					for (const [key, session] of Object.entries(value.sessions))
						if (session.id === user.id)
							delete value.sessions[key];
				}
			}
			return action === 'recover' ? { recovery, expires: this.now() + DAY } : { success: true };
		}, true, !badgeAction);
		if (action === 'disable' || action === 'recover') for (const user of users) revokeLive(user.id);
		return result;
	}
	async recover(token: unknown, password: unknown) {
		if (typeof token !== 'string')
			throw new AccountError(401, 'Recuperação inválida.');
		const encoded = await passwordHash(password);
		return this.change(value => {
			const recovery = value.recoveries[hash(token)];
			if (!recovery || recovery.expires <= this.now())
				throw new AccountError(401, 'Recuperação inválida.');
			delete value.recoveries[hash(token)];
			const account = value.accounts[recovery.id];
			if (!account.password) account.registeredAt = new Date(this.now()).toISOString();
			account.password = encoded;
			account.disabled = false;
			for (const [key, session] of Object.entries(value.sessions))
				if (session.id === recovery.id)
					delete value.sessions[key];
			return this.issue(value, recovery.id);
		}, true);
	}
}
function revokeLive(id?: string, sessionHash?: string) {
	if (!global.Users) return;
	for (const connection of Users.connections.values()) {
		const proof = connection.copaSession;
		if (proof && (!id || proof.id === id) && (!sessionHash || proof.session === sessionHash)) connection.destroy();
	}
}
export const copaAccounts = new CopaAccounts();
const rates = new Map<string, {
	count: number,
	reset: number,
}>();
function allow(key: string, max: number) {
	const now = Date.now();
	for (const [id, entry] of rates)
		if (entry.reset <= now)
			rates.delete(id);
	const entry = rates.get(key);
	if (!entry) {
		if (rates.size >= 10000)
			return false;
		rates.set(key, { count: 1, reset: now + 15 * 60000 });
		return true;
	}
	return ++entry.count <= max;
}
export function handleAccountRequest(req: IncomingMessage, res: ServerResponse, service = copaAccounts): boolean {
	const path = (req.url || '').split('?')[0];
	if (!path.startsWith('/copa-rinha/accounts/'))
		return false;
	res.setHeader('Cache-Control', 'no-store');
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Vary', 'Origin');
	const origin = req.headers.origin;
	const allowed = origin === CLIENT ||
		origin === `https://${String(req.headers.host)}` ||
		(!!origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) && !process.env.RENDER);
	if (allowed && origin)
		res.setHeader('Access-Control-Allow-Origin', origin);
	if (req.method === 'OPTIONS' && allowed) {
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		res.setHeader('Access-Control-Allow-Methods', 'POST');
		res.statusCode = 204;
		res.end();
		return true;
	}
	const reply = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
	if (!Config.copaRinhaSingleFormat ||
		!allowed ||
		req.method !== 'POST' ||
		!(req.headers['content-type'] ||
			'').startsWith('application/json')) {
		reply(403, { error: 'Solicitação não permitida.' });
		return true;
	}
	// Decode UTF-8 across transport chunks before parsing password JSON.
	req.setEncoding('utf8');
	const bodyLimit = path === '/copa-rinha/accounts/edit-trainer' ? 10240 : 8192;
	let body = '', oversized = false;
	req.on('data', chunk => {
		if (!oversized) {
			body += chunk;
			if (Buffer.byteLength(body) > bodyLimit) {
				oversized = true;
				body = '';
			}
		}
	});
	req.on('end', () => {
		void (async () => {
			try {
				if (oversized)
					throw new AccountError(413, 'Solicitação muito grande.');
				if (!allow(`ip:${req.socket.remoteAddress || ''}`, 120))
					throw new AccountError(429, 'Muitas solicitações. Aguarde 15 minutos.');
				let data;
				try { data = JSON.parse(body); } catch { throw new AccountError(400, 'Solicitação inválida.'); }
				if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AccountError(400, 'Solicitação inválida.');
				const action = path.slice('/copa-rinha/accounts/'.length);
				const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
				let result;
				if (action === 'admin') {
					const key = process.env.COPA_RINHA_ADMIN_KEY;
					if (!key || key.length < 43 || !token || !timingSafeEqual(Buffer.from(hash(key)), Buffer.from(hash(token))))
						throw new AccountError(403, 'Acesso administrativo negado.');
					if (data.action === 'get-trainer' || data.action === 'save-trainer') {
						result = await service.admin(data.action, data.name, data.profile);
					} else {
						result = await service.admin(data.action, data.names, Object.hasOwn(data, 'regions') ? data.regions : data.region);
					}
				} else if (action === 'grant')
					result = await service.grant(token, data.challenge);
				else if (action === 'profile') {
					const { id } = nameOf(data.name);
					const member = (await service.publicMembers()).find(entry => entry.id === id);
					result = { member: member || null };
				} else if (action === 'trainer') {
					result = { trainer: await service.trainer(data.name) };
				} else if (action === 'nickname-color') {
					result = await service.setNicknameColor(token, data.color);
				} else if (action === 'edit-trainer') {
					result = await service.setTrainer(token, data.card);
				} else if (action === 'partner')
					result = await service.setPartner(token, data.partner);
				else if (action === 'logout')
					result = await service.logout(token);
				else if (action === 'recover')
					result = await service.recover(data.recovery, data.password);
				else if (action === 'login' || action === 'register') {
					const { id } = nameOf(data.name);
					if (!allow(`account:${id}`, 10) || !allow(`auth:${req.socket.remoteAddress || ''}`, 30))
						throw new AccountError(429, 'Muitas tentativas. Aguarde 15 minutos.');
					result = await service.authenticate(action, data.name, data.password);
				} else
					throw new AccountError(404, 'Operação desconhecida.');
				reply(200, result);
			} catch (error) {
				reply(error instanceof AccountError ? error.status : 503, {
					error: error instanceof AccountError ? error.message : 'Contas temporariamente indisponíveis.' });
			}
		})();
	});
	return true;
}
