<template>
	<NewModal
		ref="modal"
		:header="formatMessage(modalHeader)"
		:on-hide="handleHide"
		no-padding
		max-width="548px"
		width="100%"
	>
		<div v-if="!authenticating" class="flex w-full flex-col gap-6 p-6">
			<div class="flex flex-col gap-2 px-3">
				<h2 class="m-0 text-xl font-semibold leading-7 text-contrast">
					{{ formatMessage(messages.signInHeading) }}
				</h2>
				<p class="m-0 text-base leading-6 text-primary">
					{{ formatMessage(messages.description) }}
				</p>
				<p
					v-if="formatMessage(messages.clientKeyHint)"
					class="m-0 text-sm leading-5 text-secondary"
				>
					{{ formatMessage(messages.clientKeyHint) }}
				</p>
			</div>

			<form class="flex flex-col gap-4" @submit.prevent="submitLogin">
				<label class="flex flex-col gap-1.5 px-3 text-sm text-primary">
					<span>{{ formatMessage(messages.emailLabel) }}</span>
					<input
						v-model="email"
						type="text"
						autocomplete="username"
						required
						class="rounded-lg border border-solid border-surface-4 bg-bg px-3 py-2 text-base text-contrast outline-none focus:border-brand"
					/>
				</label>
				<label class="flex flex-col gap-1.5 px-3 text-sm text-primary">
					<span>{{ formatMessage(messages.passwordLabel) }}</span>
					<input
						v-model="password"
						type="password"
						autocomplete="current-password"
						required
						class="rounded-lg border border-solid border-surface-4 bg-bg px-3 py-2 text-base text-contrast outline-none focus:border-brand"
					/>
				</label>
				<p v-if="errorMessage" class="m-0 px-3 text-sm text-red">
					{{ errorMessage }}
				</p>
				<div class="grid grid-cols-1 gap-2 px-3 sm:grid-cols-2">
					<Button class="w-full" native-type="button" :disabled="submitting" @click="openRegister">
						<UserPlusIcon aria-hidden="true" />
						{{ formatMessage(messages.createAccountButton) }}
					</Button>
					<Button
						type="colored"
						color="brand"
						class="w-full"
						native-type="submit"
						:disabled="submitting"
					>
						<LogInIcon aria-hidden="true" />
						{{
							submitting
								? formatMessage(messages.signingInButton)
								: formatMessage(messages.signInButton)
						}}
					</Button>
				</div>
				<div class="px-3">
					<Button
						type="outlined"
						class="w-full"
						native-type="button"
						:disabled="submitting"
						@click="submitBrowserLogin"
					>
						<GlobeIcon aria-hidden="true" />
						{{ formatMessage(messages.browserSignInButton) }}
					</Button>
				</div>
			</form>

			<p class="m-0 text-center text-base font-medium leading-6 text-primary">
				<IntlFormatted :message-id="messages.supportPrompt">
					<template #support="{ children }">
						<button
							type="button"
							class="inline cursor-pointer border-0 bg-transparent p-0 text-base font-medium leading-6 text-blue hover:underline"
							@click="openSupport"
						>
							<component :is="() => children" />
						</button>
					</template>
				</IntlFormatted>
			</p>
		</div>

		<div v-else class="flex w-full flex-col gap-6 p-6">
			<div class="flex flex-col gap-2.5 px-3">
				<div class="flex items-center gap-1.5 text-primary">
					<SpinnerIcon aria-hidden="true" class="h-5 w-5 shrink-0 animate-spin" />
					<span class="text-base leading-6">
						{{
							formatMessage(
								browserFlow ? messages.waitingForBrowserSignIn : messages.waitingForSignIn,
							)
						}}
					</span>
				</div>
				<p v-if="browserFlow" class="m-0 text-sm leading-5 text-secondary">
					{{ formatMessage(messages.waitingForBrowserSignInBody) }}
				</p>
			</div>
			<div class="px-3">
				<Button type="outlined" class="w-full" native-type="button" @click="modal?.hide()">
					<XIcon aria-hidden="true" />
					{{ formatMessage(commonMessages.cancelButton) }}
				</Button>
			</div>
		</div>
	</NewModal>
</template>

<script setup lang="ts">
import { GlobeIcon, LogInIcon, SpinnerIcon, UserPlusIcon, XIcon } from '@modrinth/assets'
import {
	Button,
	commonMessages,
	defineMessages,
	IntlFormatted,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, ref } from 'vue'

import {
	cancelOwyxSiteBrowserLogin,
	loginOwyxSite,
	loginOwyxSiteViaBrowser,
	OWYX_SITE_REGISTER_URL,
	OWYX_SITE_SUPPORT_URL,
	OwyxSiteAuthError,
} from '@/helpers/owyx-site-auth'

const emit = defineEmits<{
	signedIn: []
}>()

const { formatMessage } = useVIntl()
const modal = ref<InstanceType<typeof NewModal>>()
const authenticating = ref(false)
const browserFlow = ref(false)
const submitting = ref(false)
const email = ref('')
const password = ref('')
const errorMessage = ref('')
let resolveShow: ((signedIn: boolean) => void) | undefined

const modalHeader = computed(() => {
	if (!authenticating.value) return messages.header
	return browserFlow.value ? messages.browserSigningInHeader : messages.signingInHeader
})

function show(event?: MouseEvent) {
	authenticating.value = false
	browserFlow.value = false
	submitting.value = false
	errorMessage.value = ''
	password.value = ''
	resolveShow?.(false)
	const modalInstance = modal.value
	if (!modalInstance) return Promise.resolve(false)

	return new Promise<boolean>((resolve) => {
		resolveShow = resolve
		modalInstance.show(event)
	})
}

/** Kept for App.vue / invite callers that used the old signing-in helper. */
function showSigningIn(_flow = 'sign-in', _addAccount = false, event?: MouseEvent) {
	return show(event)
}

function finish(signedIn: boolean) {
	resolveShow?.(signedIn)
	resolveShow = undefined
}

function formatAuthError(e: unknown): string {
	if (e instanceof OwyxSiteAuthError) {
		if (e.code === 'missing_client_key') {
			return formatMessage(messages.errMissingClientKey)
		}
		if (e.code === 'unauthorized_client') {
			return formatMessage(messages.errUnauthorizedClient)
		}
	}
	return e instanceof Error ? e.message : String(e)
}

async function submitLogin() {
	if (submitting.value) return
	submitting.value = true
	authenticating.value = true
	browserFlow.value = false
	errorMessage.value = ''
	try {
		await loginOwyxSite(email.value, password.value)
		password.value = ''
		authenticating.value = false
		finish(true)
		emit('signedIn')
		modal.value?.hide()
	} catch (e) {
		authenticating.value = false
		errorMessage.value = formatAuthError(e)
	} finally {
		submitting.value = false
	}
}

async function submitBrowserLogin() {
	if (submitting.value) return
	submitting.value = true
	authenticating.value = true
	browserFlow.value = true
	errorMessage.value = ''
	try {
		await loginOwyxSiteViaBrowser()
		authenticating.value = false
		browserFlow.value = false
		finish(true)
		emit('signedIn')
		modal.value?.hide()
	} catch (e) {
		authenticating.value = false
		browserFlow.value = false
		const msg = formatAuthError(e)
		if (!/cancel/i.test(msg)) {
			errorMessage.value = msg
		}
	} finally {
		submitting.value = false
	}
}

function handleHide() {
	cancelOwyxSiteBrowserLogin()
	authenticating.value = false
	browserFlow.value = false
	submitting.value = false
	finish(false)
}

function openRegister() {
	openUrl(OWYX_SITE_REGISTER_URL)
}

function openSupport() {
	openUrl(OWYX_SITE_SUPPORT_URL)
}

const messages = defineMessages({
	header: {
		id: 'modal.owyx-account-required.header',
		defaultMessage: 'Account required',
	},
	signingInHeader: {
		id: 'modal.owyx-account-required.signing-in-header',
		defaultMessage: 'Signing in',
	},
	browserSigningInHeader: {
		id: 'modal.owyx-account-required.browser-signing-in-header',
		defaultMessage: 'Waiting for browser',
	},
	signInHeading: {
		id: 'modal.owyx-account-required.sign-in-heading',
		defaultMessage: 'Sign in to your Owyx account',
	},
	description: {
		id: 'modal.owyx-account-required.description',
		defaultMessage:
			'Use the same login (or email) and password as on owyx.site. Microsoft sign-in is optional for licensed skins.',
	},
	clientKeyHint: {
		id: 'modal.owyx-account-required.client-key-hint',
		defaultMessage: '',
	},
	emailLabel: {
		id: 'modal.owyx-account-required.email',
		defaultMessage: 'Login or email',
	},
	passwordLabel: {
		id: 'modal.owyx-account-required.password',
		defaultMessage: 'Password',
	},
	createAccountButton: {
		id: 'modal.owyx-account-required.create-account-button',
		defaultMessage: 'Create an account',
	},
	signInButton: {
		id: 'modal.owyx-account-required.sign-in-button',
		defaultMessage: 'Sign in to Owyx',
	},
	browserSignInButton: {
		id: 'modal.owyx-account-required.browser-sign-in-button',
		defaultMessage: 'Sign in via owyx.site',
	},
	signingInButton: {
		id: 'modal.owyx-account-required.signing-in-button',
		defaultMessage: 'Signing in…',
	},
	waitingForSignIn: {
		id: 'modal.owyx-account-required.waiting',
		defaultMessage: 'Signing in to Owyx…',
	},
	waitingForBrowserSignIn: {
		id: 'modal.owyx-account-required.waiting-browser',
		defaultMessage: 'Finish sign-in in your browser…',
	},
	waitingForBrowserSignInBody: {
		id: 'modal.owyx-account-required.waiting-browser-body',
		defaultMessage:
			'A browser tab opened on owyx.site. Sign in if needed, then tap “Return to launcher”.',
	},
	supportPrompt: {
		id: 'modal.owyx-account-required.support-prompt',
		defaultMessage: 'Need help? Visit <support>owyx.site</support>.',
	},
	errMissingClientKey: {
		id: 'modal.owyx-account-required.error.missing-client-key',
		defaultMessage:
			'Launcher is missing X-Owyx-Client-Key. Reinstall from a current GitHub release or enable Developer mode to set the key.',
	},
	errUnauthorizedClient: {
		id: 'modal.owyx-account-required.error.unauthorized-client',
		defaultMessage: 'Invalid or missing client key. Set X-Owyx-Client-Key under Owyx Servers.',
	},
})

defineExpose({
	show,
	showSigningIn,
})
</script>
