/** Public, connection-independent presence snapshots for the Copa Rinha client. */

interface PublicOnlineUser {
	name: string;
	avatar: string | number;
	status: string;
	statusType: 'online' | 'busy' | 'idle';
}

export const crqHandlers: { [k: string]: Chat.CRQHandler } = {
	copapresence(_target, _requester, trustable) {
		if (!trustable || !Config.copaRinhaSingleFormat) return false;
		const users: PublicOnlineUser[] = [];
		const seen = new Set<ID>();
		let guests = 0;
		for (const user of Users.users.values()) {
			if (!user.connected || !user.connections.length || seen.has(user.id)) continue;
			seen.add(user.id);
			if (!user.named) {
				guests++;
				continue;
			}
			// Match the public userdetails fields, never serialize a User or Connection.
			users.push({ name: user.name, avatar: user.avatar, status: user.getStatus(), statusType: user.statusType });
		}
		users.sort((a, b) => a.name.localeCompare(b.name));
		return { total: users.length + guests, guests, users };
	},
};
