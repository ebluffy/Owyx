/**
 * Owyx friends presence heartbeat for the launcher sidebar.
 * Respects sharePresence from /api/friends/settings — when off, no heartbeats
 * and friends see offline.
 */

import { readonly, shallowRef } from 'vue'

import { type OwyxFriendPresence, postOwyxPresence } from '@/helpers/owyx-friends'

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
/** Fail closed until /api/friends/settings says otherwise. */
let sharePresenceEnabled = false
let current: { status: OwyxFriendPresence; instanceName?: string | null } = {
	status: 'offline',
}

/** Live presence for UI (signed-in ≠ heartbeat running). */
const presenceStatus = shallowRef<OwyxFriendPresence>('offline')

export const owyxPresenceStatus = readonly(presenceStatus)

export function getOwyxPresenceStatus(): OwyxFriendPresence {
	return presenceStatus.value
}

export function isOwyxSharePresenceEnabled(): boolean {
	return sharePresenceEnabled
}

/** Reset local preference after sign-out (stay offline until API reloads). */
export function resetOwyxSharePresencePreference() {
	sharePresenceEnabled = false
	clearHeartbeatTimer()
	setCurrent({ status: 'offline', instanceName: null })
}

function setCurrent(next: { status: OwyxFriendPresence; instanceName?: string | null }) {
	current = next
	presenceStatus.value = next.status
}

async function push() {
	try {
		await postOwyxPresence(current)
	} catch {
		/* best-effort */
	}
}

function clearHeartbeatTimer() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer)
		heartbeatTimer = null
	}
}

function ensureHeartbeatTimer() {
	if (heartbeatTimer) return
	heartbeatTimer = setInterval(() => {
		void push()
	}, 30_000)
}

async function detectPlayingInstanceName(): Promise<string | null> {
	try {
		const { get_all } = await import('@/helpers/process.js')
		const processes = (await get_all()) as { instance_id?: string }[]
		const instanceId = processes.find((p) => p?.instance_id)?.instance_id
		if (!instanceId) return null
		const { get } = await import('@/helpers/instance')
		const { OWYX_SERVER_LINK_PREFIX } = await import('@/helpers/owyx-server-instances')
		const inst = await get(instanceId)
		const linkId = inst?.link?.type === 'imported_modpack' ? inst.link.project_id || '' : ''
		if (linkId.startsWith(OWYX_SERVER_LINK_PREFIX)) {
			return linkId.slice(0, 120)
		}
		return inst?.name?.slice(0, 120) || 'Minecraft'
	} catch {
		return null
	}
}

/**
 * Apply sharePresence from social settings.
 * OFF → stop heartbeats and force offline to friends.
 * ON → start/resume heartbeat without wiping an in-game `playing` status.
 */
export function setOwyxSharePresenceEnabled(enabled: boolean) {
	if (enabled) {
		if (sharePresenceEnabled && heartbeatTimer) {
			sharePresenceEnabled = true
			return
		}
		sharePresenceEnabled = true
		startOwyxPresenceHeartbeat()
		return
	}
	sharePresenceEnabled = false
	stopOwyxPresenceHeartbeat({ forceOfflinePush: true })
}

export function startOwyxPresenceHeartbeat() {
	if (!sharePresenceEnabled) {
		clearHeartbeatTimer()
		setCurrent({ status: 'offline', instanceName: null })
		return
	}
	// Already live (online/playing): only ensure the timer; do not wipe playing → online.
	if (current.status === 'online' || current.status === 'playing') {
		ensureHeartbeatTimer()
		return
	}
	clearHeartbeatTimer()
	// If Minecraft is already running when sharing is turned on, report playing.
	void detectPlayingInstanceName().then((name) => {
		if (!sharePresenceEnabled) return
		if (current.status === 'playing') {
			ensureHeartbeatTimer()
			return
		}
		if (name) {
			setCurrent({ status: 'playing', instanceName: name })
		} else {
			setCurrent({ status: 'online', instanceName: null })
		}
		void push()
		ensureHeartbeatTimer()
	})
}

export function stopOwyxPresenceHeartbeat(opts?: { forceOfflinePush?: boolean }) {
	clearHeartbeatTimer()
	const wasLive = current.status !== 'offline'
	setCurrent({ status: 'offline', instanceName: null })
	if (wasLive || opts?.forceOfflinePush) {
		void push()
	}
}

export function setOwyxPresencePlaying(instanceName: string) {
	if (!sharePresenceEnabled) return
	setCurrent({ status: 'playing', instanceName: instanceName.slice(0, 120) })
	void push()
	ensureHeartbeatTimer()
}

export function setOwyxPresenceOnline() {
	if (!sharePresenceEnabled) return
	setCurrent({ status: 'online', instanceName: null })
	void push()
	ensureHeartbeatTimer()
}
