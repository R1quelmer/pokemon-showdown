/** Session expiry/revocation does not change the lifetime of registered nicknames. */
import { copaAccounts } from '../copa-accounts';
let checking = false;
const timer = setInterval(() => {
	if (!Config.copaRinhaSingleFormat || checking || !global.Users)
		return;
	const connections = [...Users.connections.values()].filter(connection => connection.copaSession);
	if (!connections.length)
		return;
	for (const connection of connections) {
		if (connection.copaSession!.expires <= Date.now()) connection.destroy();
	}
	if (!connections.some(connection => connection.user)) return;
	checking = true;
	void copaAccounts.validSessions().then(value => {
		const now = Date.now();
		for (const connection of connections) {
			if (!connection.user || !connection.copaSession) continue;
			const proof = connection.copaSession;
			if (proof.expires <= now || !value.sessions[proof.session] || value.accounts[proof.id]?.disabled)
				connection.destroy();
		}
	}).catch(() => { }).finally(() => { checking = false; });
}, 30000);
timer.unref();
