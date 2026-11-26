'use strict';
const assert = require('node:assert/strict');

describe('Copa avatar catalog', () => {
	it('suggests public variants and only the requesting player’s permitted specials', () => {
		const { Avatars, crqHandlers } = require("../../dist/server/chat-commands/avatars");
		const previous = Config.copaRinhaSingleFormat;
		const user = { id: 'avatarcatalogtest', named: true, previousIDs: new Set() };
		const other = { id: 'avatarcatalogother', named: true, previousIDs: new Set() };
		Config.copaRinhaSingleFormat = true;
		Avatars.avatars[user.id] = { allowed: [null, '#catalog-special', 'local-costume.png'] };
		try {
			const catalog = crqHandlers.copaavatars.call({}, '', user, true);
			assert(catalog.length > 1000);
			assert.equal(catalog.length, new Set(catalog).size);
			for (const name of catalog) assert.equal(Avatars.userCanUse(user, name), name);
			for (const name of ['acetrainer-gen3jp', 'marnie', '#catalog-special', 'local-costume.png']) {
				assert(catalog.includes(name), name);
			}
			assert(!crqHandlers.copaavatars.call({}, '', other, true).includes('#catalog-special'));
			assert.equal(crqHandlers.copaavatars.call({}, '', user, false), null);
			Config.copaRinhaSingleFormat = false;
			assert.equal(crqHandlers.copaavatars.call({}, '', user, true), null);
		} finally {
			delete Avatars.avatars[user.id];
			Config.copaRinhaSingleFormat = previous;
		}
	});
});
