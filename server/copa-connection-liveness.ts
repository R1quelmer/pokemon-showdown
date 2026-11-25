/**
 * SockJS 0.3's raw WebSocket transport has no heartbeat of its own. Use the
 * transport's RFC 6455 ping/pong support, without requiring a Showdown command
 * or treating an idle/background player as a disconnected player.
 */
const PING_INTERVAL = 30 * 1000;
const PONG_GRACE = 90 * 1000;

type RawConnection = import('sockjs').Connection & {
	_session?: {
		ws?: { ping(message: string, callback: () => void): boolean },
	},
};

export function watchCopaConnection(socket: import('sockjs').Connection): () => void {
	const ws = (socket as RawConnection)._session?.ws;
	if (socket.protocol !== 'websocket-raw' || typeof ws?.ping !== 'function') return () => {};

	let stopped = false;
	let pending = false;
	let probeStarted = 0;
	let lastResponsive = Date.now();
	const received = () => { lastResponsive = Date.now(); };
	const cleanup = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		socket.removeListener('data', received);
		socket.removeListener('close', cleanup);
	};
	const timer = setInterval(() => {
		if (pending) {
			if (Date.now() - Math.max(probeStarted, lastResponsive) >= PONG_GRACE) {
				cleanup();
				// @types/sockjs declares a string code; its actual Faye transport
				// accepts the numeric WebSocket close code. close preserves the
				// native close event and normal Users/socket/room cleanup.
				try {
					(socket.close as unknown as (code: number, reason: string) => void)(3000, 'No response from heartbeat');
				} catch {}
			}
			return;
		}
		pending = true;
		probeStarted = Date.now();
		try {
			if (!ws.ping('copa-rinha-heartbeat', () => {
				if (stopped) return;
				pending = false;
				received();
			})) cleanup();
		} catch {
			// A different transport/version must retain its native lifecycle.
			cleanup();
		}
	}, PING_INTERVAL);
	timer.unref();
	socket.on('data', received);
	socket.once('close', cleanup);
	return cleanup;
}
