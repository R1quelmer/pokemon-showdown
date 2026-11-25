/** Public-only metadata index. Listing never scans or downloads battle logs. */
import {
	type S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Replay } from './copa-replays';

export type ReplaySummary = Pick<Replay, 'id' | 'format' | 'createdAt' | 'players' | 'winner' | 'turns' | 'endType'>;
export interface ReplayPage { replays: ReplaySummary[]; cursor: string | null }
export interface ReplayQuery { player: string; cursor: string }
const prefix = 'replay-index/v1/';
export function publicSummary(replay: Replay): ReplaySummary | null {
	if (replay?.visibility !== 'public' || !/^[A-Za-z0-9_-]{32}$/.test(replay.id) ||
		replay.format !== 'gen9coparinhanationaldexza' || !Number.isFinite(Date.parse(replay.createdAt)) ||
		!Array.isArray(replay.players) || replay.players.length !== 2 ||
		!replay.players.every(player => typeof player.name === 'string' && player.name.length <= 40 &&
			/^[a-z0-9]{1,18}$/.test(player.userid)) ||
			typeof replay.winner !== 'string' || !Number.isSafeInteger(replay.turns) || replay.turns < 0 ||
			typeof replay.endType !== 'string') return null;
	return { id: replay.id, format: replay.format, createdAt: replay.createdAt,
		players: replay.players.map(player => ({ name: player.name, userid: player.userid })),
		winner: replay.winner, turns: replay.turns, endType: replay.endType };
}
function indexKeys(replay: Replay) {
	const key = `${String(9999999999999 - Date.parse(replay.createdAt)).padStart(13, '0')}-${replay.id}.json`;
	return ['all/', ...new Set(replay.players.map(player => `player/${player.userid}/`))].map(path => prefix + path + key);
}
export function replayIndex(client: S3Client, bucket: string) {
	const cache = new Map<string, { expires: number, page: ReplayPage }>();
	return {
		async unindex(replay: Replay) {
			// One authoritative visibility record fences stale global/player pointers.
			await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}records/${replay.id}.json`,
				Body: JSON.stringify({ visibility: 'private' }), ContentType: 'application/json' }));
			cache.clear();
			for (const Key of indexKeys(replay)) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
		},
		async index(replay: Replay) {
			const summary = publicSummary(replay);
			if (!summary) return;
			// Fixed-width reverse timestamp sorts newest first without downloading older entries.
			const body = JSON.stringify({ ...summary, visibility: 'public' });
			const recordKey = `${prefix}records/${replay.id}.json`;
			const existing = async () => {
				try {
					const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: recordKey }));
					if (!result.Body || (result.ContentLength || 0) > 8192) throw new Error('Invalid metadata');
					return JSON.parse(await result.Body.transformToString());
				} catch (error: any) {
					if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
					throw error;
				}
			};
			let record = await existing();
			if (!record) {
				try {
					await client.send(new PutObjectCommand({ Bucket: bucket, Key: recordKey, Body: body,
						ContentType: 'application/json', IfNoneMatch: '*' }));
				} catch (error: any) {
					if (![409, 412].includes(error.$metadata?.httpStatusCode)) throw error;
					record = await existing();
				}
			}
			// A repair must never revive a canonical privacy tombstone.
			if (record && record.visibility !== 'public') return;

			for (const Key of indexKeys(replay)) {
				await client.send(new PutObjectCommand({ Bucket: bucket, Key,
					Body: JSON.stringify({ id: replay.id }), ContentType: 'application/json' }));
			}
			cache.clear();
		},
		async list(query: ReplayQuery): Promise<ReplayPage> {
			const path = prefix + (query.player ? `player/${query.player}/` : 'all/');
			const cacheKey = `${query.player}:${query.cursor}`;
			const cached = cache.get(cacheKey);
			if (cached && cached.expires > Date.now()) return cached.page;
			const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: path,
				MaxKeys: 20, ContinuationToken: query.cursor || undefined }));
			const replays: ReplaySummary[] = [];
			for (const object of (result.Contents || []).slice(0, 20)) {
				if (!object.Key?.startsWith(path)) continue;
				const id = /^\d{13}-([A-Za-z0-9_-]{32})\.json$/.exec(object.Key.slice(path.length))?.[1];
				if (!id) continue;
				try {
					const entry = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}records/${id}.json` }));
					if (!entry.Body || (entry.ContentLength || 0) > 8192) continue;
					const body = await entry.Body.transformToString();
					if (Buffer.byteLength(body) > 8192) continue;
					const summary = publicSummary(JSON.parse(body));
					if (summary?.id === id && (!query.player || summary.players.some(player => player.userid === query.player))) {
						replays.push(summary);
					}
				} catch (error: any) {
					if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) throw error;
				}
			}
			const page = { replays, cursor: result.NextContinuationToken || null };
			if (cache.size >= 128) cache.clear();
			cache.set(cacheKey, { expires: Date.now() + 15000, page });
			return page;
		},
	};
}
