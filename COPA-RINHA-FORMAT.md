# Copa Rinha II: public single-format policy

Public name: **Copa Rinha II**. Canonical format ID: `gen9coparinhanationaldexza`.

## Investigation and implementation

`config/custom-formats.ts` registers the format. Previously `DexFormats.load`
keyed it by `toID(name)`, and BasicEffect derived its ID from the same name.
The loader/Format constructor now honor an optional explicit ID, while keeping
name lookup as an alias. Copa declares its existing ID and new name explicitly.
Official format definitions remain loaded and unchanged. The mod, ruleset,
validator and mechanics data have not changed; search visibility is now enabled.

The native `|formats` protocol sends names and visibility flags, not a separate
ID. Its public list is filtered in the Copa preset; upgraded client parsers map
the new name back to the canonical ID. Therefore deploy the client first.

`server/copa-format-policy.ts` is the common policy for public player battles:
only the canonical format/its native names are authorized; custom-rule variants
are rejected. `Ladder.prepBattle` covers Search and Challenge preparation (and
tournaments), before team validation/rating work. `Rooms.createBattle` guards the
central creation point too, covering direct creation paths and stale challenges.
Accepted display names are canonicalized before room creation, so battle/room IDs
and the replay-saving filter keep using the existing canonical identifier.
Rejected players receive: “Este servidor utiliza exclusivamente o formato Copa
Rinha II.” The shared policy also filters advertised formats.

The existing Render preset enables `Config.copaRinhaSingleFormat` automatically.
For local Copa deployment, set `exports.copaRinhaSingleFormat = true` in
`config/config.js`. Default is false for normal upstream/local test use. The
policy does not affect simulator creation, parsing, Dex loading, TeamValidator
or replay playback. Internal validators can still validate official formats.

## Replays and teams

The canonical ID and room-ID generation remain compatible. Replay filtering,
R2 storage, GET endpoint and CORS were not modified. Existing objects need no
migration. The upgraded client renders both old and new replay tier labels as
Copa Rinha II without rewriting the historical log or metadata.

## Validation and deployment

Relevant checks:

```sh
npm run build
npm run tsc -- --noEmit
npm run lint
npx mocha --no-config --exit test/main.js test/server/copa-format-policy.js test/server/copa-replays.js test/server/coparinha-render.js test/server/ladders.js test/server/room-battle.js test/sim/othermetas/coparinha.js test/sim/othermetas/coparinha-za.js
```

Final result: build, TypeScript and lint passed; 140 focused tests passed.
The focused suites cover public-name/ID compatibility, native valid-team Search
and Challenge preparation, creation of a Copa player battle, manual attempts to
use OU/Random/custom formats and custom rules, advertised list filtering, local
unrestricted operation, replay upload/API with mocked storage, and existing
Mega/ZA Mega/Z/Tera/Dynamax/G-Max simulator regressions. No live R2 upload was
performed here. Existing production credentials/settings are unchanged.

1. Deploy client branch `feat/copa-rinha-gimmick-ui` first. Its new parser handles
   both old/new servers. Keep the full build, publishing `play.pokemonshowdown.com`;
   refresh the cached server checkout to this server branch/commit for the data build.
2. When the client is Live, deploy this server branch
   `feat/copa-rinha-national-dex-za`. Keep existing Render build/start settings.
   The Render preset applies the restriction; no new environment variable is needed.
3. Reload both browser sessions. Check Copa Rinha II in search, challenge and
   new-team creation. Import/export/validate a team, challenge another player,
   finish the match and check the saved replay. Old replay links must also open.
4. Attempt `/search gen9ou`, `/search gen9randombattle` and a challenge in another
   format; verify a clean rejection and no battle creation. Use a valid team for
   a genuine Copa match. Confirm the object in the private R2 console and canonical
   format ID in the API JSON. Do not change bucket access or credentials.
