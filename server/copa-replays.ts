/** Private R2 storage for completed Copa Rinha battles. */
import { randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export const FORMAT = 'gen9coparinhanationaldexza';
export const CLIENT = 'https://copa-rinha-client.onrender.com';
export const validID = (id: string) => /^[A-Za-z0-9_-]{32}$/.test(id);
export const newID = () => randomBytes(24).toString('base64url');
const userid = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export interface Replay {
	id: string;
	format: string;
	createdAt: string;
	roomid: string;
	players: { name: string, userid: string }[];
	winner: string;
	winnerid: string;
	turns: number;
	endType: string;
	log: string;
}
export interface Storage {
	put(replay: Replay): Promise<void>;
	get(id: string): Promise<Replay | null>;
}
// SDK error strings/messages are untrusted: emit only fixed, recognized identifiers.
const ERROR_NAMES = new Set([
	'Error', 'TypeError', 'EndpointError', 'CredentialsProviderError', 'InvalidAccessKeyId',
	'AccessDenied', 'SignatureDoesNotMatch', 'NoSuchBucket', 'NoSuchKey', 'InvalidArgument',
	'InvalidRequest', 'NotImplemented', 'ServiceUnavailable', 'InternalError', 'SlowDown',
	'RequestTimeout', 'RequestTimeTooSkewed', 'TimeoutError', 'NetworkingError', 'AbortError',
	'ReplayConfigurationError', 'PermanentRedirect', 'AuthorizationHeaderMalformed',
	'InvalidDigest', 'BadDigest', 'XAmzContentSHA256Mismatch', 'InvalidBucketName', 'S3ServiceException',
	'UnknownError', 'ERR_INVALID_URL', 'ERR_INVALID_CHAR',
]);
const NETWORK_CODES = new Set([
	'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
	'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ERR_TLS_CERT_ALTNAME_INVALID',
	'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
]);
type ReplayStage = 'PrepareReplay' | 'ConfigureR2' | 'PutObject' | 'AnnounceReplay' | 'GetObject';
export function replayFailure(stage: ReplayStage, error: unknown) {
	const read = (value: unknown, key: string): unknown => {
		try {
			return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
		} catch {
			return undefined;
		}
	};
	const identifier = (value: unknown) => typeof value === 'string' &&
		(ERROR_NAMES.has(value) || NETWORK_CODES.has(value)) ? value : 'UnrecognizedError';
	const status = (value: unknown) => typeof value === 'number' && Number.isInteger(value) &&
		value >= 100 && value <= 599 ? value : undefined;
	const name = identifier(read(error, 'name'));
	const code = identifier(read(error, 'code') ?? read(error, 'Code'));
	const causeCode = identifier(read(read(error, 'cause'), 'code'));
	const timeout = [name, code, causeCode].some(value => /Timeout|TIMEDOUT/.test(value));
	const connection = [name, code, causeCode].some(value => NETWORK_CODES.has(value));
	return {
		stage, name, code, causeCode, timeout, connection,
		httpStatusCode: status(read(error, 'statusCode')),
		metadataHttpStatusCode: status(read(read(error, '$metadata'), 'httpStatusCode')),
	};
}
function reportFailure(stage: ReplayStage, error: unknown) {
	console.warn(`Copa Rinha: falha no replay. ${JSON.stringify(replayFailure(stage, error))}`);
}
let storage: Storage | undefined;
export function r2Storage(): Storage {
	if (storage) return storage;
	const {
		R2_BUCKET: bucket, R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey,
	} = process.env;
	if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
		const error = new Error('Replay storage unavailable');
		error.name = 'ReplayConfigurationError';
		throw error;
	}
	const client = new S3Client({
		region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2,
		requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
	});
	storage = {
		async put(replay) {
			await client.send(new PutObjectCommand({
				Bucket: bucket, Key: `replays/${replay.id}.json`, Body: JSON.stringify(replay), ContentType: 'application/json',
			}));
		},
		async get(id) {
			try {
				const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `replays/${id}.json` }));
				return JSON.parse(await result.Body!.transformToString());
			} catch (error: any) {
				if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
				reportFailure('GetObject', error);
				throw new Error('Replay storage unavailable');
			}
		},
	};
	return storage;
}
// Remove human communication, keeping battle protocol (including every gimmick).
export function cleanLog(log: string) {
	return log.split('\n').filter(line => !/^\|(?:c|c:|chat|chatmsg|pm|uhtml|uhtmlchange|raw|html)\|/.test(line)).join('\n');
}
export interface CompletedBattle {
	format: string;
	roomid: string;
	players: { name: string }[];
	endType: string;
	room: { getLog(channel: -1): string, add(message: string): { update(): unknown } };
}
export async function saveBattle(battle: CompletedBattle, winner: string, store?: Storage): Promise<Replay | null> {
	if (battle.format !== FORMAT) return null;
	let stage: ReplayStage = 'PrepareReplay';
	try {
		const log = cleanLog(battle.room.getLog(-1));
		const turns = [...log.matchAll(/^\|turn\|(\d+)$/gm)].map(match => Number(match[1]));
		const replay: Replay = {
			id: newID(), format: FORMAT, createdAt: new Date().toISOString(), roomid: battle.roomid,
			players: battle.players.map(p => ({ name: p.name, userid: userid(p.name) })),
			winner, winnerid: userid(winner), turns: Math.max(0, ...turns),
			endType: !winner ? 'tie' : battle.endType, log,
		};
		stage = 'ConfigureR2';
		const target = store || r2Storage();
		stage = 'PutObject';
		await target.put(replay);
		stage = 'AnnounceReplay';
		const url = `${CLIENT}/replay.html?id=${replay.id}`;
		battle.room.add(`|raw|<div class="infobox">Replay da Copa Rinha salvo — <a href="${url}" target="_blank" rel="noopener">Assistir replay</a> · <copytext value="${url}">Copiar link</copytext></div>`).update();
		return replay;
	} catch (error) {
		reportFailure(stage, error);
		return null;
	}
}
export function handleReplayRequest(req: IncomingMessage, res: ServerResponse, store?: Storage): boolean {
	const path = (req.url || '').split('?')[0];
	if (!path.startsWith('/copa-rinha/replays/')) return false;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Vary', 'Origin');
	if (req.headers.origin === CLIENT) res.setHeader('Access-Control-Allow-Origin', CLIENT);
	const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		reply(405, { error: 'Método não permitido' });
		return true;
	}
	const id = path.slice('/copa-rinha/replays/'.length);
	if (!validID(id)) {
		reply(400, { error: 'ID inválido' });
		return true;
	}
	void (async () => {
		try {
			const replay = await (store || r2Storage()).get(id);
			reply(replay ? 200 : 404, replay || { error: 'Replay não encontrado' });
		} catch {
			reply(503, { error: 'Armazenamento temporariamente indisponível' });
		}
	})();
	return true;
}
