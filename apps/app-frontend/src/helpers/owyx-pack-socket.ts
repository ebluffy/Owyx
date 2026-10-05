/**
 * Subscribe to site `pack_updated` socket events (E2 / P3-b).
 * Requires a signed-in Owyx JWT; no-ops when socket.io-client is unavailable.
 */

import { io, type Socket } from 'socket.io-client'

import { getStoredOwyxApiBase, sanitizeOwyxApiBase } from '@/helpers/owyx-api'
import { getStoredOwyxSiteSession } from '@/helpers/owyx-site-auth'

export type OwyxPackUpdatedEvent = {
	packId: string
	version?: string | null
	sha256?: string | null
	size?: number | null
	at?: string
}

let socket: Socket | null = null
const listeners = new Set<(event: OwyxPackUpdatedEvent) => void>()

function apiOrigin(): string {
	const base = sanitizeOwyxApiBase(getStoredOwyxApiBase())
	try {
		return new URL(base).origin
	} catch {
		return base.replace(/\/$/, '')
	}
}

function ensureSocket(): Socket | null {
	const token = getStoredOwyxSiteSession()?.token?.trim()
	if (!token) {
		teardownOwyxPackSocket()
		return null
	}
	if (socket?.connected) return socket

	teardownOwyxPackSocket()
	socket = io(apiOrigin(), {
		path: '/socket.io',
		auth: { token },
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
	return socket
}

export function subscribeOwyxPackUpdated(
	listener: (event: OwyxPackUpdatedEvent) => void,
): () => void {
	listeners.add(listener)
	ensureSocket()
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) teardownOwyxPackSocket()
	}
}

export function teardownOwyxPackSocket() {
	if (socket) {
		socket.removeAllListeners()
		socket.disconnect()
		socket = null
	}
}
