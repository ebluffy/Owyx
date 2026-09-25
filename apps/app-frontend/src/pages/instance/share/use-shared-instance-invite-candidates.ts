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
		const ownUserId = options.currentUserId.value
		const rawUsers = await searchOwyxUsers(query.trim())

		for (const user of rawUsers) {
			searchUserHits.set(user.id, { id: user.id, nickname: user.nickname })
			searchUserHits.set(normalizeInviteKey(user.nickname), {
				id: user.id,
				nickname: user.nickname,
			})
			if (user.displayNickname) {
				searchUserHits.set(normalizeInviteKey(user.displayNickname), {
					id: user.id,
					nickname: user.nickname,
				})
			}
		}

		return rawUsers
			.filter((user) => !ownUserId || user.id !== ownUserId)
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
				username: user.nickname,
				avatarUrl: user.avatarUrl || undefined,
			}))
	}

	function resolveLoginNickname(user: InvitePlayersUser): string {
		const hit = searchUserHits.get(user.id) ?? searchUserHits.get(normalizeInviteKey(user.username))
		if (hit?.nickname) return hit.nickname

		const normalized = normalizeInviteKey(user.username)
		const friend = friends.value.find(
			(f) =>
				(f.userId || f.id) === user.id ||
				normalizeInviteKey(f.nickname) === normalized ||
				(f.displayNickname && normalizeInviteKey(f.displayNickname) === normalized),
		)
		if (friend?.nickname) return friend.nickname

		return user.username
	}

	async function requestFriend(user: InvitePlayersUser) {
		if (options.actionsLocked.value) return
		const loginNick = resolveLoginNickname(user)
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
