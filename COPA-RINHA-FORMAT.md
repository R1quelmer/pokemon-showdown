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

## Stock psim.us clients: explicit Gen 9 protocol name

The official server still serializes `|formats|` as section/column markers plus
`name,hexFlags`. It does **not** transmit an independent canonical ID, generation
field, or National Dex capability. Both official parsers derive `toID(name)`.
When that result does not start with `gen`, the historical teambuilder fallback
creates `[Gen 6] <name>` as an auxiliary format. The new picker accepts synthetic
entries whose visibility fields are undefined, unlike the legacy truthy checks,
which explains why the auxiliary and original entries can both appear.

The engine format keeps `name: Copa Rinha II` and its explicit canonical ID
`gen9coparinhanationaldexza`. It now declares an independent **protocol name**
`[Gen 9] Copa Rinha II`, in section Copa Rinha, column 1. Flags remain hex `e`
(search, challenge, tournament; player-built teams). Both stock parsers create
one native Gen 9 format, without the auxiliary Gen 6 entry.

The stock client necessarily derives the *wire alias* `gen9coparinhaii`, because
its protocol has no separate ID. The server registers the protocol name as an
alias, normalizes incoming Search/Challenge/cancellation and room creation to
the canonical ID, and translates outgoing UI-only search/challenge references
to the wire alias. Matchmaking, validation, ladder keys, room IDs and replay
storage keep the canonical identifier. Battle `|tier|` and room-list labels use
the generation-qualified protocol name; this changes labels, not battle rules.

The New Client intentionally strips `[Gen 9]` in some current-generation selectors.
Such a selector may show only “Copa Rinha II” even when its native model correctly
contains `[Gen 9] Copa Rinha II`, generation 9. Server-side data cannot override
that stock rendering convention without client changes; no CSS/string spoof is
used here. Existing local teams saved under the earlier erroneous Gen 6 entry
may need their format reassigned to the new entry in the official teambuilder.

Fixtures in `test/server/fixtures/official-formats` preserve the actual upstream
old/new parser and BattleFormat constructor excerpts, with provenance/licenses.
Tests remove only TypeScript annotations, reproduce the broken Gen 6 auxiliary
entry, and verify the actual server packet in both native implementations. They
also verify native validator aliases, Search/Challenge/cancel packets, canonical
battle identity and generation-qualified playback tier. No custom client parser
is used in these regressions.

Deployment for this correction: **server only**, branch
`feat/copa-rinha-national-dex-za`. Keep Render settings and all R2 variables.
After Live, reload/reconnect the official psim.us page so the server sends a fresh
`|formats|` packet. Switch between New and Old Client and confirm one entry.
Choose that entry for team validation, search and challenge. No deployment or
modification of `pokemon-showdown-client` is part of this correction. Its earlier
custom-name normalization is not the solution for the stock psim.us clients.

No R2/storage/API/CORS code was changed or real R2 access performed in this task.
Automated parser tests are offline snapshots, not a claim of a production match
on psim.us. Test a completed match after deploying and verify its saved ID and
an existing replay link as the production acceptance check.

Final verification for the psim.us correction: `npm run build`,
`npm run tsc -- --noEmit`, `npm run lint` passed, and the focused command above
plus `test/server/copa-format-protocol.js` passed **145 tests**. The private client
repository has no changes from this task.
