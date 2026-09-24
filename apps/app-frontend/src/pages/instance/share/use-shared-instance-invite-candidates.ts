import {
	injectNotificationManager,
	type InvitePlayersSearchUser,
	type InvitePlayersUser,
} from '@modrinth/ui'
import { computed, onMounted, ref, type Ref, watch } from 'vue'

import {
	listOwyxFriends,
	requestOwyxFriend,
	searchOwyxUsers,
	type OwyxFriend,
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
	watch(
		[options.isSignedIn, options.actionsLocked],
		() => void refreshFriends(),
	)

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
					online: friend.presence !== 'offline',
					status: invited ? (invited.pending ? 'pending' : 'added') : 'available',
				}
			}),
	)

	const candidateKeys = computed(() => {
		const keys = new Set<string>()
		for (const friend of inviteFriends.value) {
			keys.add(normalizeInviteKey(friend.id))
			keys.add(normalizeInviteKey(friend.username))
		}
		return keys
	})

	async function search(query: string): Promise<InvitePlayersSearchUser[]> {
		if (options.actionsLocked.value || !query.trim()) return []
		const ownUserId = options.currentUserId.value
		return (await searchOwyxUsers(query.trim()))
			.filter((user) => !ownUserId || user.id !== ownUserId)
			.filter((user) => {
				const id = normalizeInviteKey(user.id)
				const username = normalizeInviteKey(user.displayNickname || user.nickname)
				return !candidateKeys.value.has(id) && !candidateKeys.value.has(username)
			})
			.map((user) => ({
				id: user.id,
				username: user.displayNickname || user.nickname,
				avatarUrl: user.avatarUrl || undefined,
			}))
	}

	async function requestFriend(user: InvitePlayersUser) {
		if (options.actionsLocked.value) return
		try {
			await requestOwyxFriend(user.username)
			await refreshFriends()
		} catch (error) {
			handleError(error)
		}
	}

	return { inviteFriends, search, requestFriend, loading }
}
