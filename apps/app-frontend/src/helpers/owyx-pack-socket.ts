/**
 * Subscribe to site `pack_updated` socket events (E2 / P3-b).
 * Requires a signed-in Owyx JWT; reconnects when the session changes (P3-b3).
 *
 * Auth/API deps are injectable so node:test can cover reconnect without Vite aliases.
 * Call {@link installOwyxPackSocketDeps} once at app bootstrap (`main.js`) before any subscribe.
 */

import { io, type Socket } from 'socket.io-client'

export type OwyxPackUpdatedEvent = {
	packId: string
	version?: string | null
	sha256?: string | null
	size?: number | null
	at?: string
}

export type OwyxPackSocketDeps = {
	io: typeof io
	getToken: () => string
	getOrigin: () => string
	onSessionCleared: (cb: () => void) => () => void
	onSessionChanged: (cb: () => void) => () => void
}

let socket: Socket | null = null
/** Last token used to open the current socket — skip force-reconnect if unchanged. */
let socketToken: string | null = null
const listeners = new Set<(event: OwyxPackUpdatedEvent) => void>()
let unsubSessionCleared: (() => void) | null = null
let unsubSessionChanged: (() => void) | null = null
let depsInstalled = false
let warnedMissingDeps = false

function warnIfDepsMissing(fn: string) {
	if (depsInstalled || warnedMissingDeps) return
	warnedMissingDeps = true
	console.warn(
		`[owyx-pack-socket] ${fn}: deps not installed — call installOwyxPackSocketDeps() at app bootstrap`,
	)
}

/** Injectable for unit tests (P3-b3) and app wiring. */
export const packSocketDeps: OwyxPackSocketDeps = {
	io,
	getToken: () => {
		warnIfDepsMissing('getToken')
		return ''
	},
	getOrigin: () => 'https://api.owyx.site',
	onSessionCleared: () => () => {},
	onSessionChanged: () => () => {},
}

export function installOwyxPackSocketDeps(partial: Partial<OwyxPackSocketDeps>) {
	Object.assign(packSocketDeps, partial)
	depsInstalled = true
	warnedMissingDeps = false
}

function bindSessionHooks() {
	if (!unsubSessionCleared) {
		unsubSessionCleared = packSocketDeps.onSessionCleared(() => {
			closeSocket()
		})
	}
	if (!unsubSessionChanged) {
		unsubSessionChanged = packSocketDeps.onSessionChanged(() => {
			if (listeners.size > 0) ensureSocket()
		})
	}
}

function unbindSessionHooks() {
	unsubSessionCleared?.()
	unsubSessionCleared = null
	unsubSessionChanged?.()
	unsubSessionChanged = null
}

/** Close the live socket only — keep session hooks so login can reconnect (P3-b3). */
function closeSocket() {
	if (socket) {
		socket.removeAllListeners()
		socket.disconnect()
		socket = null
	}
	socketToken = null
}

function ensureSocket(): Socket | null {
	bindSessionHooks()
	const token = packSocketDeps.getToken()
	if (!token) {
		closeSocket()
		return null
	}
	// P3-b4 / P3-b6: reuse only while the manager is still alive (`active`).
	// `connected` is false during autoConnect and backoff — keep those.
	// After a hard middleware reject, socket.io sets `active === false` and
	// will not auto-reconnect — must recreate on the next ensureSocket call.
	if (socket?.active && socketToken === token) return socket

	closeSocket()
	socketToken = token
	socket = packSocketDeps.io(packSocketDeps.getOrigin(), {
		path: '/socket.io',
		auth: (cb: (data: { token: string }) => void) => {
			cb({ token: packSocketDeps.getToken() })
		},
		transports: ['websocket', 'polling'],
		autoConnect: true,
		reconnection: true,
		reconnectionDelayMax: 15_000,
	})
	socket.on('pack_updated', (payload: OwyxPackUpdatedEvent) => {
		if (!payload?.packId) return
		for (const listener of listeners) {
			try {
				listener(payload)
			} catch {
				/* ignore listener errors */
			}
		}
	})
	socket.on('session_revoked', () => {
		closeSocket()
	})
	socket.on('connect_error', (err: Error) => {
		const msg = String(err?.message || '')
		const authReject = /invalid token|authentication required|banned/i.test(msg)
		// P3-b6: middleware rejects (e.g. "Server misconfigured") leave active=false
		// with no auto-reconnect — drop the dead handle so the next ensure can recreate.
		if (authReject || socket?.active === false) {
			closeSocket()
		}
	})
	return socket
}

export function subscribeOwyxPackUpdated(
	listener: (event: OwyxPackUpdatedEvent) => void,
): () => void {
	listeners.add(listener)
	bindSessionHooks()
	ensureSocket()
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) {
			closeSocket()
			unbindSessionHooks()
		}
	}
}

/** Public full teardown (socket + hooks). Prefer unsubscribe when listeners remain. */
export function teardownOwyxPackSocket() {
	closeSocket()
	unbindSessionHooks()
}

/** Test helper — reset module state between cases. */
export function __resetOwyxPackSocketForTests() {
	teardownOwyxPackSocket()
	listeners.clear()
	depsInstalled = false
	warnedMissingDeps = false
	packSocketDeps.io = io
	packSocketDeps.getToken = () => {
		warnIfDepsMissing('getToken')
		return ''
	}
	packSocketDeps.getOrigin = () => 'https://api.owyx.site'
	packSocketDeps.onSessionCleared = () => () => {}
	packSocketDeps.onSessionChanged = () => () => {}
}
