/** Public, connection-independent presence snapshots for the Copa Rinha client. */
import { copaAccounts } from '../copa-accounts';

function isPublicRoom(room: Room): boolean {
	return !room.settings.isPrivate && !room.settings.modjoin && (!room.parent || isPublicRoom(room.parent));
}

function publicBattle(user: User) {
	if (user.settings.hideBattlesFromTrainerCard) return undefined;
	return [...user.games].find(id => {
		const room = Rooms.get(id);
		return !!room?.battle && !room.battle.ended && isPublicRoom(room);
	});
}

function memberPresence(accounts: Awaited<ReturnType<typeof copaAccounts.publicMembers>>) {
	return accounts.map(({ id, name, avatar, partner }) => {
		const user = Users.getExact(id);
		if (!user?.connected || !user.named || !user.connections.some(connection => connection.hasCopaSession(user))) {
			return { name, avatar, ...(partner && { partner }), online: false, rooms: [] };
		}
		const rooms: string[] = [];
		for (const roomid of user.inRooms) {
			const room = Rooms.get(roomid);
			if (room?.persist && room.type === 'chat' && !room.settings.isPersonal && isPublicRoom(room)) {
				rooms.push(room.title);
			}
		}
		return {
			name, avatar: user.avatar, ...(partner && { partner }), online: true, battle: publicBattle(user), rooms: rooms.sort(),
		};
	}).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

interface PublicOnlineUser {
	name: string;
	avatar: string | number;
	status: string;
	statusType: 'online' | 'busy' | 'idle';
	inBattle: boolean;
}

export const crqHandlers: { [k: string]: Chat.CRQHandler } = {
	copapresence(target, requester, trustable) {
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
			const inBattle = !!publicBattle(user);
			users.push({ name: user.name, avatar: user.avatar, status: user.getStatus(), statusType: user.statusType, inBattle });
		}
		users.sort((a, b) => a.name.localeCompare(b.name));
		const snapshot = {
			total: users.length + guests, guests, users,
			copaBattleCounts: requester ? Rooms.global.getCopaBattles(requester, '', true).counts : undefined,
		};
		if (target !== 'members' && target !== 'nicknames') return snapshot;
		return copaAccounts.publicMembers().then(accounts => ({
			...snapshot,
			nicknames: accounts.filter(account => account.nicknameColor || account.badges.length).map(account => ({
				id: account.id, color: account.nicknameColor, gold: account.goldNickname, badges: account.badges,
			})),
			...(target === 'members' && { members: memberPresence(accounts) }),
		}), () => ({ ...snapshot, ...(target === 'members' && { members: null }) }));
	},
};
