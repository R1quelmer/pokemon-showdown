/** Immutable, unlisted team shares in the existing private Copa Rinha R2 bucket. */
import type { IncomingMessage, ServerResponse } from 'http';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Dex } from '../sim/dex';
import { Teams } from '../sim/teams';
import { CLIENT, FORMAT, newID, validID, replayFailure } from './copa-replays';

export { CLIENT, FORMAT, validID };
export const MAX_TEAM_BYTES = 64 * 1024;
export const MAX_SETS = 300; // The native teams plugin also accepts boxes of up to 300 sets.
export interface TeamInput {
	name?: string | null;
	format: string;
	packedTeam: string;
}
export interface SharedTeam {
	schemaVersion: 1;
	id: string;
	createdAt: string;
	format: string;
	name: string;
	packedTeam: string;
	importText: string;
}
export interface TeamStorage {
	/** Must create only; an existing ID must never be overwritten. */
	put(team: SharedTeam): Promise<void>;
	get(id: string): Promise<SharedTeam | null>;
}
export class TeamInputError extends Error {}
export class TeamStorageError extends Error {}

function report(stage: 'ConfigureR2' | 'PutObject' | 'GetObject', error: unknown) {
	console.warn(`Copa Rinha: falha no armazenamento de time. ${JSON.stringify(replayFailure(stage, error))}`);
}

/** Keep the upstream team serializer: this is storage validation, not battle legality. */
export function prepareTeam(input: TeamInput): Omit<SharedTeam, 'id' | 'createdAt'> {
	if (!input || typeof input.packedTeam !== 'string' || !input.packedTeam.trim() ||
		Buffer.byteLength(input.packedTeam, 'utf8') > MAX_TEAM_BYTES) {
		throw new TeamInputError(`Time inválido ou maior que ${MAX_TEAM_BYTES / 1024} KiB.`);
	}
	if (typeof input.format !== 'string' || input.format.length > 150 || input.format.includes('@@@')) {
		throw new TeamInputError('Formato inválido.');
	}
	const format = Dex.formats.get(input.format);
	if (!format.exists || format.id !== FORMAT || format.customRules?.length) {
		throw new TeamInputError('Este compartilhamento usa o formato Copa Rinha II.');
	}
	if (input.name !== undefined && input.name !== null && typeof input.name !== 'string') {
		throw new TeamInputError('Nome do time inválido.');
	}
	const name = (input.name || '').trim();
	if (name.length > 100 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
		throw new TeamInputError('Nome do time inválido (máximo 100 caracteres).');
	}
	let sets;
	try {
		sets = Teams.import(input.packedTeam, true);
	} catch {
		throw new TeamInputError('Não foi possível importar o time.');
	}
	if (!sets?.length || sets.length > MAX_SETS) {
		throw new TeamInputError(`O time deve conter de 1 a ${MAX_SETS} Pokémon.`);
	}
	for (const set of sets) {
		if (!Dex.species.get(set.species).exists) throw new TeamInputError('Espécie desconhecida no time.');
		if (!Array.isArray(set.moves) || set.moves.length > 24 || !set.moves.length) {
			throw new TeamInputError('Cada Pokémon deve ter de 1 a 24 movimentos.');
		}
		if (set.moves.some(move => !Dex.moves.get(move).exists)) throw new TeamInputError('Movimento desconhecido no time.');
		// Preserve the native plugin's support for OM values in build fields.
		const known = (value: string) => [Dex.abilities, Dex.items, Dex.moves, Dex.species, Dex.types, Dex.natures]
			.some(table => table.get(value).exists);
		for (const field of ['item', 'ability', 'nature', 'teraType'] as const) {
			if (set[field] && !known(set[field])) throw new TeamInputError('Build com valor desconhecido.');
		}
		if (set.level !== undefined && (!Number.isInteger(set.level) || set.level < 1 || set.level > 9999)) {
			throw new TeamInputError('Nível inválido.');
		}
		for (const field of ['evs', 'ivs'] as const) {
			for (const value of Object.values(set[field] || {})) {
				if (!Number.isInteger(value) || value < 0 || value > (field === 'ivs' ? 31 : 252)) {
					throw new TeamInputError('EVs/IVs inválidos.');
				}
			}
		}
	}
	const packedTeam = Teams.pack(sets);
	if (!packedTeam || Buffer.byteLength(packedTeam, 'utf8') > MAX_TEAM_BYTES) {
		throw new TeamInputError('Time muito grande.');
	}
	return { schemaVersion: 1, format: FORMAT, name, packedTeam, importText: Teams.export(sets) };
}
/** A bounded in-memory throttle; it does not persist identifying information in R2. */
export class TeamRateLimiter {
	private entries = new Map<string, { count: number, reset: number }>();
	private limit: number;
	private period: number;
	private capacity: number;
	constructor(limit: number, period: number, capacity = 10000) {
		this.limit = limit;
		this.period = period;
		this.capacity = capacity;
	}
	allow(key: string, now = Date.now()) {
		for (const [storedKey, entry] of this.entries) {
			if (entry.reset <= now) this.entries.delete(storedKey);
		}
		let entry = this.entries.get(key);
		if (!entry) {
			if (this.entries.size >= this.capacity) return false;
			entry = { count: 0, reset: now + this.period };
			this.entries.set(key, entry);
		}
		if (entry.count >= this.limit) return false;
		entry.count++;
		return true;
	}
}
export const uploadLimiter = new TeamRateLimiter(10, 60 * 60 * 1000);
const readLimiter = new TeamRateLimiter(600, 60 * 1000);
/** Same bounded read budget for HTTP and native chat-page access. */
export function allowTeamRead(ip: string): boolean {
	return readLimiter.allow(ip);
}
let storage: TeamStorage | undefined;
export function r2TeamStorage(): TeamStorage {
	if (storage) return storage;
	const {
		R2_BUCKET: bucket, R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey,
	} = process.env;
	if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
		report('ConfigureR2', new Error('Unavailable'));
		throw new TeamStorageError('Armazenamento temporariamente indisponível.');
	}
	const client = new S3Client({
		region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2,
		requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
	});
	storage = {
		async put(team) {
			try {
				await client.send(new PutObjectCommand({
					Bucket: bucket, Key: `teams/${team.id}.json`, Body: JSON.stringify(team),
					ContentType: 'application/json', IfNoneMatch: '*',
				}));
			} catch (error) {
				report('PutObject', error);
				throw new TeamStorageError('Não foi possível salvar o time. Tente novamente.');
			}
		},
		async get(id) {
			try {
				const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `teams/${id}.json` }));
				if ((result.ContentLength || 0) > 4 * MAX_TEAM_BYTES || !result.Body) throw new Error('Invalid stored data');
				const text = await result.Body.transformToString();
				if (Buffer.byteLength(text, 'utf8') > 4 * MAX_TEAM_BYTES) throw new Error('Invalid stored data');
				const data = JSON.parse(text);
				return publicTeam(data, id);
			} catch (error: any) {
				if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
				report('GetObject', error);
				throw new TeamStorageError('Armazenamento temporariamente indisponível.');
			}
		},
	};
	return storage;
}
function publicTeam(value: SharedTeam, id: string): SharedTeam {
	if (!value || value.id !== id || value.schemaVersion !== 1 || typeof value.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid stored data');
	const prepared = prepareTeam(value);
	return { ...prepared, id, createdAt: value.createdAt };
}
export async function shareTeam(input: TeamInput, store?: TeamStorage): Promise<SharedTeam> {
	const prepared = prepareTeam(input);
	const team: SharedTeam = { ...prepared, id: newID(), createdAt: new Date().toISOString() };
	await (store || r2TeamStorage()).put(team);
	return team;
}
export function teamURL(id: string) {
	if (!validID(id)) throw new TeamInputError('ID inválido.');
	return `${CLIENT}/team.html?id=${id}`;
}
export function handleTeamRequest(req: IncomingMessage, res: ServerResponse, store?: TeamStorage): boolean {
	const pathname = (req.url || '').split('?')[0];
	if (!pathname.startsWith('/copa-rinha/teams/')) return false;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Cache-Control', 'private, max-age=60');
	res.setHeader('Vary', 'Origin');
	if (req.headers.origin === CLIENT) res.setHeader('Access-Control-Allow-Origin', CLIENT);
	const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		reply(405, { error: 'Método não permitido' });
		return true;
	}
	const id = pathname.slice('/copa-rinha/teams/'.length);
	if (!validID(id)) { reply(400, { error: 'ID inválido' }); return true; }
	if (!allowTeamRead(req.socket?.remoteAddress || 'unknown')) {
		res.setHeader('Retry-After', '60');
		reply(429, { error: 'Muitas solicitações. Tente novamente em um minuto.' });
		return true;
	}
	void (async () => {
		try {
			const team = await (store || r2TeamStorage()).get(id);
			reply(team ? 200 : 404, team ? publicTeam(team, id) : { error: 'Time não encontrado' });
		} catch {
			reply(503, { error: 'Armazenamento temporariamente indisponível' });
		}
	})();
	return true;
}
