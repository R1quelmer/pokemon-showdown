# Copa Rinha on Render Free

Deploy the `feat/copa-rinha-national-dex-za` branch as a Node web service.
Use Node 24 (Node 22.18+ is also supported).

- Build command: `npm ci && npm run build`
- Start command: `node pokemon-showdown start --skip-build $PORT`
- Health check path: `/showdown/info`
- Recommended `NODE_OPTIONS`: `--max-old-space-size=256 --max-semi-space-size=8`

Render provides `RENDER=true` and `PORT` automatically. The tracked
`server/coparinha-render.ts` settings are applied by the config loader after
reading the usual configuration. The build still creates the ignored
`config/config.js` from `config/config-example.js` when it is absent. There is
no need to create, commit, or upload a private `config/config.js` for this preset.

On Render, the preset forces `subprocesses = 0`, removes deprecated process
counts that could override it, and binds to `0.0.0.0` on `PORT` (default 10000
if unset). All configured process types run in the main Node process using
Showdown's existing inline implementations. Team validation, simulation and
WebSocket/SockJS remain enabled. The listening message will say **Worker 0**,
which is the network worker running inside the main process.

Render handles public HTTPS/WSS on port 443 and forwards to the internal
HTTP/WS listener; the server does not need local TLS certificates. The REPL
and config-file watcher are disabled for this deployment. Outside Render,
the usual configuration is unchanged. The Copa Rinha format and gimmick
rules are unchanged.

This Copa Rinha Render preset enables `noguestsecurity = true`, so clients can
choose an unregistered local nickname with `/trn NAME` and no assertion or
password. **Local nicknames are not secure authentication: another person who
knows the server can use a name when it is available.** Do not use these names
as proof of identity. No password or official Showdown credentials are stored
by this feature. Outside Render this setting is unchanged.

The format is advertised as `[Gen 9] [Copa Rinha] National Dex ZA`, with the
canonical ID `gen9coparinhanationaldexza`; it still uses `mod: 'coparinha'`.
Redeploy the matching client branch too, so previously saved IDs
`coparinhanationaldexza` and `gen6coparinhanationaldexza` are migrated by the
Teambuilder. No rules or gimmick limits changed with this ID migration.

`--max-old-space-size=384` caps only V8's old generation, **not** total process
memory. The young generation, native allocations, code and buffers also count
toward Render's 512 MB limit. A 256 MiB old-generation limit plus an 8 MiB
semi-space limit leaves more room for those allocations (about 280 MiB maximum
V8 heap on the tested Node 24 runtime). This is a starting point for small
test battles, not a guarantee for unlimited concurrent games. Monitor RSS and
Render's memory graph under your expected load.

For an existing Render service, redeploy this branch and replace an existing
384 MiB `NODE_OPTIONS` setting with the recommended value above. Keep the
start command as shown. No PM2, cluster launcher or additional Node worker is
required. Repository changes do not automatically edit an existing Render
service's environment variables or health-check settings.
