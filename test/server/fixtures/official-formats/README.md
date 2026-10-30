# Stock client format parser snapshots

These fixtures are unmodified excerpts of the upstream client implementation,
not the customized Copa Rinha client. Source:

- `new-client.txt`: `MainMenuRoom.parseFormats`, AGPLv3,
  https://github.com/smogon/pokemon-showdown-client/blob/master/play.pokemonshowdown.com/src/panel-mainmenu.tsx
- `old-client.txt`: `App.parseFormats`, AGPLv3,
  https://github.com/smogon/pokemon-showdown-client/blob/master/play.pokemonshowdown.com/src/oldclient/client.js
- `format-constructor.txt`: `BattleFormat.constructor`, MIT,
  https://github.com/smogon/pokemon-showdown-client/blob/master/play.pokemonshowdown.com/src/battle-dex-data.ts

Copyright Guangcong Luo and Pokémon Showdown contributors. License texts are
included alongside these test-only snapshots. The test removes TypeScript type
annotations only, provides minimal UI callbacks and invokes the native algorithms
with the actual server format packet. No Copa client ID normalization is applied.

Comparison source for stock server serialization (same name + hexadecimal flags,
no independent ID/generation/National Dex field):
https://github.com/smogon/pokemon-showdown/blob/master/server/rooms.ts

The generation-6 fallback is in the native parser and constructor. The newer
picker includes synthetic entries with undefined visibility flags, whereas the
legacy picker uses truthy visibility/battleFormat filtering. A generation-prefixed
wire name prevents the auxiliary teambuilder entry from being created at all.
