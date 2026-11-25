'use strict';
// Offline maintenance, never called by the HTTP API. Unknown visibility is never inferred.
// Run only after reviewing deployment/storage access; this task does not execute it against R2.
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { publicSummary } = require('../dist/server/copa-replay-index');
const { r2Storage } = require('../dist/server/copa-replays');
async function main() {
	const mode = process.argv.slice(2);
	if (mode.length !== 1 || !['--dry-run', '--write'].includes(mode[0])) {
		console.log('Usage: node tools/copa-replay-reindex.js --dry-run|--write');
		return;
	}
	const { R2_BUCKET: bucket, R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId,
		R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
	if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) throw new Error('Storage unavailable');
	const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2,
		requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 } });
	const target = r2Storage();
	let cursor, scanned = 0, confirmedPublic = 0, skipped = 0;
	do {
		const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'replays/',
			MaxKeys: 100, ContinuationToken: cursor }));
		for (const object of page.Contents || []) {
			if (!/^replays\/[A-Za-z0-9_-]{32}\.json$/.test(object.Key || '')) continue;
			scanned++;
			const entry = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
			if (!entry.Body || (entry.ContentLength || 0) > 8 * 1024 * 1024) { skipped++; continue; }
			const replay = JSON.parse(await entry.Body.transformToString());
			if (object.Key !== `replays/${replay.id}.json`) { skipped++; continue; }
			if (!publicSummary(replay)) {
				if (['private', 'unlisted'].includes(replay.visibility) &&
					publicSummary({ ...replay, visibility: 'public' }) && mode[0] === '--write') await target.unindex(replay);
				skipped++; continue;
			}
			confirmedPublic++;
			if (mode[0] === '--write') await target.index(replay);
		}
		cursor = page.NextContinuationToken;
	} while (cursor);
	console.log(JSON.stringify({ mode: mode[0], scanned, confirmedPublic, skipped }));
}
main().catch(() => {
	console.error('Reindexação interrompida. Nenhum detalhe de credenciais foi registrado; os logs originais não são alterados.');
	process.exitCode = 1;
});
