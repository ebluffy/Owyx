<template>
	<div v-if="!owyx.isSignedIn.value" class="flex flex-col items-center gap-4 py-8 text-center">
		<p class="m-0 text-lg font-semibold text-contrast">{{ formatMessage(messages.signInTitle) }}</p>
		<p class="m-0 max-w-md text-secondary">{{ formatMessage(messages.signInBody) }}</p>
		<Button type="colored" color="brand" size="xl" @click="owyx.signIn()">
			{{ formatMessage(messages.signIn) }}
		</Button>
	</div>

	<div v-else class="flex flex-col gap-6 max-w-xl">
		<section class="flex flex-col gap-2">
			<label class="text-sm text-secondary">{{ formatMessage(messages.nickLabel) }}</label>
			<input
				v-model="editNick"
				class="rounded-lg border border-solid border-surface-5 bg-surface-3 px-3 py-2 text-primary"
				maxlength="16"
			/>
			<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.nickHint) }}</p>
			<label class="text-sm text-secondary">{{ formatMessage(messages.discordLabel) }}</label>
			<input
				:value="editDiscord"
				class="rounded-lg border border-solid border-surface-5 bg-surface-3 px-3 py-2 text-primary opacity-70"
				placeholder="—"
				readonly
				disabled
			/>
			<p class="m-0 text-xs text-secondary">{{ formatMessage(messages.discordHint) }}</p>
			<div class="flex flex-wrap gap-2 mt-1">
				<Button type="colored" color="brand" :disabled="saving" @click="saveProfile">
					{{ saving ? '…' : formatMessage(messages.save) }}
				</Button>
				<Button class="!bg-button-bg" @click="openProfileSite">
					{{ formatMessage(messages.openProfile) }}
				</Button>
				<Button class="!bg-button-bg" @click="owyx.signOut()">
					{{ formatMessage(messages.signOut) }}
				</Button>
			</div>
			<p v-if="statusMsg" class="m-0 text-sm" :class="statusOk ? 'text-green' : 'text-red'">
				{{ statusMsg }}
			</p>
		</section>
	</div>
</template>

<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, ref, watch } from 'vue'

import { OWYX_SITE_PROFILE_URL, updateOwyxDisplayNickname } from '@/helpers/owyx-site-auth'
import { injectOwyxSiteSession } from '@/providers/owyx-site-session'

const { formatMessage } = useVIntl()
const owyx = injectOwyxSiteSession()

const displayName = computed(
	() =>
		(owyx.session.value?.user?.displayNickname || owyx.session.value?.user?.nickname || 'Owyx').trim(),
)

const editNick = ref(displayName.value)
const editDiscord = computed(
	() => (owyx.session.value?.user as { discord?: string } | undefined)?.discord || '',
)
const saving = ref(false)
const statusMsg = ref('')
const statusOk = ref(true)

watch(displayName, (n) => {
	editNick.value = n
})

async function saveProfile() {
	saving.value = true
	statusMsg.value = ''
	try {
		const nick = editNick.value.trim()
		if (nick && nick !== displayName.value) {
			await updateOwyxDisplayNickname(nick)
		}
		statusOk.value = true
		statusMsg.value = formatMessage(messages.saved)
		await owyx.refresh()
	} catch (e) {
		statusOk.value = false
		statusMsg.value = e instanceof Error ? e.message : String(e)
	} finally {
		saving.value = false
	}
}

function openProfileSite() {
	window.open(OWYX_SITE_PROFILE_URL, '_blank', 'noopener,noreferrer')
}

const messages = defineMessages({
	signInTitle: {
		id: 'owyx.settings.profile.sign-in-title',
		defaultMessage: 'Owyx account required',
	},
	signInBody: {
		id: 'owyx.settings.profile.sign-in-body',
		defaultMessage: 'Sign in with the same login as on owyx.site to manage your profile.',
	},
	signIn: {
		id: 'owyx.settings.profile.sign-in',
		defaultMessage: 'Sign in',
	},
	nickLabel: {
		id: 'owyx.settings.profile.display-nick',
		defaultMessage: 'Display nickname',
	},
	nickHint: {
		id: 'owyx.settings.profile.display-nick-hint',
		defaultMessage: 'Shown to friends in the UI. Offline play uses your login nick.',
	},
	discordLabel: {
		id: 'owyx.settings.profile.discord',
		defaultMessage: 'Discord username',
	},
	discordHint: {
		id: 'owyx.settings.profile.discord-hint',
		defaultMessage: 'Linked via Discord OAuth on the site only.',
	},
	save: {
		id: 'owyx.settings.profile.save',
		defaultMessage: 'Save',
	},
	saved: {
		id: 'owyx.settings.profile.saved',
		defaultMessage: 'Profile saved',
	},
	openProfile: {
		id: 'owyx.settings.profile.open-site',
		defaultMessage: 'Open on owyx.site',
	},
	signOut: {
		id: 'owyx.settings.profile.sign-out',
		defaultMessage: 'Sign out of Owyx',
	},
})
</script>
