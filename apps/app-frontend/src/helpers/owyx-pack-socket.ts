/**
 * Subscribe to site `pack_updated` socket events (E2 / P3-b).
 * Requires a signed-in Owyx JWT; reconnects when the session changes (P3-b2).
 */

import { io, type Socket } from 'socket.io-client'

import { getStoredOwyxApiBase, sanitizeOwyxApiBase } from '@/helpers/owyx-api'
import {
	getStoredOwyxSiteSession,
	onOwyxSiteSessionChanged,
	onOwyxSiteSessionCleared,
} from '@/helpers/owyx-site-auth'

export type OwyxPackUpdatedEvent = {
	packId: string
	version?: string | null
	sha256?: string | null
	size?: number | null
	at?: string
}

let socket: Socket | null = null
const listeners = new Set<(event: OwyxPackUpdatedEvent) => void>()
let unsubSessionCleared: (() => void) | null = null
let unsubSessionChanged: (() => void) | null = null

function apiOrigin(): string {
	const base = sanitizeOwyxApiBase(getStoredOwyxApiBase())
	try {
		return new URL(base).origin
	} catch {
		return base.replace(/\/$/, '')
	}
}

function bindSessionHooks() {
	if (!unsubSessionCleared) {
		unsubSessionCleared = onOwyxSiteSessionCleared(() => {
			teardownOwyxPackSocket()
		})
	}
	if (!unsubSessionChanged) {
		unsubSessionChanged = onOwyxSiteSessionChanged(() => {
			if (listeners.size > 0) ensureSocket({ force: true })
		})
	}
}

function ensureSocket(opts?: { force?: boolean }): Socket | null {
	const token = getStoredOwyxSiteSession()?.token?.trim()
	if (!token) {
		teardownOwyxPackSocket()
		return null
	}
	if (socket?.connected && !opts?.force) return socket

	teardownOwyxPackSocket({ keepHooks: true })
	bindSessionHooks()
	socket = io(apiOrigin(), {
		path: '/socket.io',
		// Fresh token on every (re)connect — static auth dies after rotation (P3-b2).
		auth: (cb: (data: { token: string }) => void) => {
			cb({ token: getStoredOwyxSiteSession()?.token?.trim() || '' })
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
		teardownOwyxPackSocket()
	})
	socket.on('connect_error', (err: Error) => {
		const msg = String(err?.message || '')
		if (/invalid token|authentication required|banned/i.test(msg)) {
			teardownOwyxPackSocket()
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
		if (listeners.size === 0) teardownOwyxPackSocket()
	}
}

export function teardownOwyxPackSocket(opts?: { keepHooks?: boolean }) {
	if (socket) {
		socket.removeAllListeners()
		socket.disconnect()
		socket = null
	}
	if (!opts?.keepHooks) {
		unsubSessionCleared?.()
		unsubSessionCleared = null
		unsubSessionChanged?.()
		unsubSessionChanged = null
	}
}
