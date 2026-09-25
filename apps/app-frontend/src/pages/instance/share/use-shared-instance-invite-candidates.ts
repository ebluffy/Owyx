import {
	injectNotificationManager,
	type InvitePlayersSearchUser,
	type InvitePlayersUser,
} from '@modrinth/ui'
import { computed, onMounted, type Ref, ref, watch } from 'vue'

import {
	listOwyxFriends,
	type OwyxFriend,
	requestOwyxFriend,
	searchOwyxUsers,
} from '@/helpers/owyx-friends'
import { getStoredOwyxSiteSession } from '@/helpers/owyx-site-auth'

import { normalizeInviteKey, type ShareRow } from './shared-instance-share-types'

export function useSharedInstanceInviteCandidates(options: {
	rows: Ref<ShareRow[]>
	currentUserId: Ref<string | null>
	isSignedIn: Ref<boolean>
	actionsLocked: Ref<boolean>
}) {
	const { handleError } = injectNotificationManager()
	const friends = ref<OwyxFriend[]>([])
	const loading = ref(false)
	const searchUserHits = new Map<string, { id: string; nickname: string }>()

	async function refreshFriends() {
		if (!options.isSignedIn.value || options.actionsLocked.value) {
			friends.value = []
			return
		}
		loading.value = true
		try {
			friends.value = await listOwyxFriends()
		} catch (error) {
			handleError(error)
		} finally {
			loading.value = false
		}
	}

	onMounted(() => void refreshFriends())
	watch([options.isSignedIn, options.actionsLocked], () => void refreshFriends())

	const invitedRows = computed(() => {
		const invited = new Map<string, ShareRow>()
		for (const row of options.rows.value) {
			invited.set(normalizeInviteKey(row.id), row)
			invited.set(normalizeInviteKey(row.username), row)
		}
		return invited
	})

	const inviteFriends = computed<InvitePlayersUser[]>(() =>
		friends.value
			.filter((friend) => friend.status === 'accepted')
			.map((friend) => {
				const id = friend.userId || friend.id
				const username = friend.displayNickname || friend.nickname
				const invited =
					invitedRows.value.get(normalizeInviteKey(id)) ??
					invitedRows.value.get(normalizeInviteKey(username))
				return {
					id,
					username,
					avatarUrl: friend.avatarUrl || undefined,
					online: friend.presence === 'online' || friend.presence === 'playing',
					status: invited ? (invited.pending ? 'pending' : 'added') : 'available',
				}
			}),
	)

	const candidateKeys = computed(() => {
		const keys = new Set<string>()
		const owyxUser = getStoredOwyxSiteSession()?.user
		if (owyxUser?.id) keys.add(normalizeInviteKey(String(owyxUser.id)))
		if (owyxUser?.nickname) keys.add(normalizeInviteKey(owyxUser.nickname))
		if (owyxUser?.displayNickname) keys.add(normalizeInviteKey(owyxUser.displayNickname))
		if (options.currentUserId.value)
			keys.add(normalizeInviteKey(String(options.currentUserId.value)))

		for (const key of invitedRows.value.keys()) {
			keys.add(key)
		}
		for (const friend of inviteFriends.value) {
			keys.add(normalizeInviteKey(friend.id))
			keys.add(normalizeInviteKey(friend.username))
		}
		for (const friend of friends.value) {
			if (friend.id) keys.add(normalizeInviteKey(friend.id))
			if (friend.userId) keys.add(normalizeInviteKey(friend.userId))
			if (friend.nickname) keys.add(normalizeInviteKey(friend.nickname))
			if (friend.displayNickname) keys.add(normalizeInviteKey(friend.displayNickname))
		}
		return keys
	})

	async function search(query: string): Promise<InvitePlayersSearchUser[]> {
		if (options.actionsLocked.value || !query.trim()) return []
		const ownUserId = options.currentUserId.value ? String(options.currentUserId.value) : null
		const owyxUser = getStoredOwyxSiteSession()?.user
		const ownOwyxId = owyxUser?.id ? String(owyxUser.id) : null
		const ownOwyxNick = owyxUser?.nickname ? normalizeInviteKey(owyxUser.nickname) : null
		const ownOwyxDisplay = owyxUser?.displayNickname
			? normalizeInviteKey(owyxUser.displayNickname)
			: null

		const rawUsers = await searchOwyxUsers(query.trim())

		if (searchUserHits.size > 500) {
			searchUserHits.clear()
		}
		for (const user of rawUsers) {
			const entry = { id: user.id, nickname: user.nickname }
			searchUserHits.set(user.id, entry)
			searchUserHits.set(normalizeInviteKey(user.id), entry)
			searchUserHits.set(normalizeInviteKey(user.nickname), entry)
			if (user.displayNickname) {
				searchUserHits.set(normalizeInviteKey(user.displayNickname), entry)
			}
		}

		return rawUsers
			.filter((user) => {
				if (ownUserId && user.id === ownUserId) return false
				if (ownOwyxId && String(user.id) === ownOwyxId) return false
				const loginNick = normalizeInviteKey(user.nickname)
				if (ownOwyxNick && loginNick === ownOwyxNick) return false
				if (ownOwyxDisplay && loginNick === ownOwyxDisplay) return false
				if (user.displayNickname) {
					const displayNick = normalizeInviteKey(user.displayNickname)
					if (ownOwyxNick && displayNick === ownOwyxNick) return false
					if (ownOwyxDisplay && displayNick === ownOwyxDisplay) return false
				}
				return true
			})
			.filter((user) => {
				const id = normalizeInviteKey(user.id)
				const loginNick = normalizeInviteKey(user.nickname)
				const displayNick = user.displayNickname ? normalizeInviteKey(user.displayNickname) : null
				return (
					!candidateKeys.value.has(id) &&
					!candidateKeys.value.has(loginNick) &&
					(!displayNick || !candidateKeys.value.has(displayNick))
				)
			})
			.map((user) => ({
				id: user.id,
				username: user.displayNickname || user.nickname,
				avatarUrl: user.avatarUrl || undefined,
			}))
	}

	async function resolveLoginNickname(user: InvitePlayersUser): Promise<string> {
		const hit =
			searchUserHits.get(user.id) ??
			searchUserHits.get(normalizeInviteKey(user.id)) ??
			searchUserHits.get(normalizeInviteKey(user.username))
		if (hit?.nickname) return hit.nickname

		const normalized = normalizeInviteKey(user.username)
		const friend = friends.value.find(
			(f) =>
				(f.userId || f.id) === user.id ||
				normalizeInviteKey(f.nickname) === normalized ||
				(f.displayNickname && normalizeInviteKey(f.displayNickname) === normalized),
		)
		if (friend?.nickname) return friend.nickname

		// Fallback: if cache hit or friend was not found (e.g. race condition),
		// query Owyx API directly by username/id before falling back to raw username.
		try {
			const fallbackUsers = await searchOwyxUsers(user.username)
			const exact = fallbackUsers.find(
				(u) =>
					u.id === user.id ||
					normalizeInviteKey(u.nickname) === normalized ||
					(u.displayNickname && normalizeInviteKey(u.displayNickname) === normalized),
			)
			if (exact?.nickname) {
				const entry = { id: exact.id, nickname: exact.nickname }
				searchUserHits.set(exact.id, entry)
				searchUserHits.set(normalizeInviteKey(exact.nickname), entry)
				return exact.nickname
			}
		} catch {
			// ignore fallback search failure
		}

		return user.username
	}

	async function requestFriend(user: InvitePlayersUser) {
		if (options.actionsLocked.value) return
		const loginNick = await resolveLoginNickname(user)
		if (!loginNick) return
		try {
			await requestOwyxFriend(loginNick)
			await refreshFriends()
		} catch (error) {
			handleError(error)
		}
	}

	return { inviteFriends, search, requestFriend, loading }
}
