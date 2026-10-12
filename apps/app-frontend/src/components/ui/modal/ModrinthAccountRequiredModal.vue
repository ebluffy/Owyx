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

			<div
				v-if="errorMessage"
				role="alert"
				aria-live="polite"
				class="mx-3 rounded-lg border border-red/30 bg-red/10 p-3 text-sm text-red"
			>
				{{ errorMessage }}
			</div>

			<form class="flex flex-col gap-4 px-3" @submit.prevent="submitPasswordLogin">
				<label class="flex flex-col gap-1.5 text-sm" for="owyx-login-identifier">
					<span class="font-medium text-contrast">
						{{ formatMessage(messages.loginLabel) }}
					</span>
					<Input
						id="owyx-login-identifier"
						v-model="loginInput"
						name="username"
						type="text"
						autocomplete="username"
						:placeholder="formatMessage(messages.loginPlaceholder)"
						:disabled="submitting"
						required
						wrapper-class="w-full"
					/>
				</label>

				<label class="flex flex-col gap-1.5 text-sm" for="owyx-login-password">
					<span class="font-medium text-contrast">
						{{ formatMessage(messages.passwordLabel) }}
					</span>
					<Input
						id="owyx-login-password"
						v-model="passwordInput"
						name="password"
						:type="showPassword ? 'text' : 'password'"
						autocomplete="current-password"
						:placeholder="formatMessage(messages.passwordPlaceholder)"
						:disabled="submitting"
						required
						wrapper-class="w-full"
					>
						<template #trailing>
							<button
								type="button"
								class="flex size-7 items-center justify-center rounded text-secondary hover:text-contrast focus:outline-none"
								:aria-label="
									formatMessage(
										showPassword ? messages.hidePasswordAria : messages.showPasswordAria,
									)
								"
								:aria-pressed="showPassword"
								:disabled="submitting"
								@click="showPassword = !showPassword"
							>
								<EyeOffIcon v-if="showPassword" class="size-4" aria-hidden="true" />
								<EyeIcon v-else class="size-4" aria-hidden="true" />
							</button>
						</template>
					</Input>
				</label>

				<Button
					type="colored"
					color="brand"
					class="mt-2 w-full"
					native-type="submit"
					:disabled="submitting || !canSubmitPassword"
				>
					<SpinnerIcon v-if="submitting" aria-hidden="true" class="h-4 w-4 shrink-0 animate-spin" />
					{{
						submitting
							? formatMessage(messages.signingInButton)
							: formatMessage(messages.signInButton)
					}}
				</Button>
			</form>

			<div class="relative flex items-center px-3 py-1">
				<div class="flex-grow border-t border-surface-5" />
				<span class="mx-3 shrink-0 text-xs uppercase text-secondary">
					{{ formatMessage(messages.orDivider) }}
				</span>
				<div class="flex-grow border-t border-surface-5" />
			</div>

			<div class="grid grid-cols-1 gap-2 px-3 sm:grid-cols-2">
				<Button
					class="w-full"
					native-type="button"
					:disabled="submitting"
					@click="submitBrowserLogin"
				>
					<GlobeIcon aria-hidden="true" />
					{{ formatMessage(messages.browserSignInButton) }}
				</Button>
				<Button class="w-full" native-type="button" :disabled="submitting" @click="openRegister">
					<UserPlusIcon aria-hidden="true" />
					{{ formatMessage(messages.createAccountButton) }}
				</Button>
			</div>

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
			<div class="flex flex-col gap-3 px-3">
				<div class="flex items-center gap-2 text-primary">
					<SpinnerIcon aria-hidden="true" class="h-5 w-5 shrink-0 animate-spin" />
					<span class="text-base font-semibold leading-6 text-contrast">
						{{ formatMessage(messages.waitingForBrowserSignIn) }}
					</span>
				</div>
				<p class="m-0 text-sm leading-5 text-secondary">
					{{
						browserOpened === true
							? formatMessage(messages.waitingForBrowserSignInBody)
							: formatMessage(messages.browserOpenStatusUnknown)
					}}
				</p>
				<div
					v-if="browserUrl"
					class="mt-2 flex flex-col gap-2 rounded-lg border border-surface-5 bg-surface-2 p-3"
				>
					<div
						v-if="errorMessage"
						role="alert"
						aria-live="polite"
						class="rounded-lg border border-red/30 bg-red/10 p-3 text-sm text-red"
					>
						{{ errorMessage }}
					</div>
					<p class="m-0 text-xs font-medium text-secondary">
						{{ formatMessage(messages.manualUrlPrompt) }}
					</p>
					<div
						class="rounded bg-surface-3 p-2 font-mono text-xs text-secondary select-all break-all"
					>
						{{ browserUrl }}
					</div>
					<p class="m-0 text-xs leading-5 text-secondary">
						{{ formatMessage(messages.browserManualUrlHint) }}
					</p>
					<div class="mt-1 flex flex-wrap gap-2">
						<Button type="outlined" class="text-xs" native-type="button" @click="copyBrowserUrl">
							<CheckIcon v-if="copiedUrl" class="size-4 text-green" aria-hidden="true" />
							<CopyIcon v-else class="size-4" aria-hidden="true" />
							{{
								copiedUrl
									? formatMessage(messages.copiedLinkButton)
									: formatMessage(messages.copyLinkButton)
							}}
						</Button>
						<Button type="outlined" class="text-xs" native-type="button" @click="openBrowserUrl">
							<ExternalIcon class="size-4" aria-hidden="true" />
							{{ formatMessage(messages.openLinkButton) }}
						</Button>
					</div>
				</div>
			</div>
			<div class="flex flex-col gap-2 px-3">
				<Button
					type="colored"
					color="brand"
					class="w-full"
					native-type="button"
					@click="switchToPassword"
				>
					{{ formatMessage(messages.switchToPasswordButton) }}
				</Button>
				<Button type="outlined" class="w-full" native-type="button" @click="modal?.hide()">
					<XIcon aria-hidden="true" />
					{{ formatMessage(commonMessages.cancelButton) }}
				</Button>
			</div>
		</div>
	</NewModal>
</template>

<script setup lang="ts">
import {
	CheckIcon,
	CopyIcon,
	ExternalIcon,
	EyeIcon,
	EyeOffIcon,
	GlobeIcon,
	SpinnerIcon,
	UserPlusIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Button,
	commonMessages,
	defineMessages,
	Input,
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
	reopenOwyxSiteBrowserLoginUrl,
} from '@/helpers/owyx-site-auth'

const emit = defineEmits<{
	signedIn: []
}>()

const { formatMessage } = useVIntl()
const modal = ref<InstanceType<typeof NewModal>>()
const authenticating = ref(false)
const browserFlow = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const browserUrl = ref('')
const browserOpened = ref<boolean | null>(null)
const copiedUrl = ref(false)

const loginInput = ref('')
const passwordInput = ref('')
const showPassword = ref(false)

const canSubmitPassword = computed(() => {
	return loginInput.value.trim().length > 0 && passwordInput.value.length > 0
})

let resolveShow: ((signedIn: boolean) => void) | undefined

const modalHeader = computed(() => {
	if (!authenticating.value) return messages.header
	return messages.browserSigningInHeader
})

function show(event?: MouseEvent) {
	cancelOwyxSiteBrowserLogin()
	authenticating.value = false
	browserFlow.value = false
	submitting.value = false
	errorMessage.value = ''
	browserUrl.value = ''
	copiedUrl.value = false
	loginInput.value = ''
	passwordInput.value = ''
	showPassword.value = false
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
		switch (e.code) {
			case 'missing_client_key':
				return formatMessage(messages.errMissingClientKey)
			case 'unauthorized_client':
				return formatMessage(messages.errUnauthorizedClient)
			case 'invalid_credentials':
				return formatMessage(messages.errInvalidCredentials)
			case 'access_denied':
				return formatMessage(messages.errAccessDenied)
			case 'rate_limited':
				return formatMessage(messages.errRateLimited)
			case 'canceled':
				return ''
			case 'network':
				return formatMessage(messages.errNetwork)
			case 'timeout':
				return formatMessage(messages.errTimeout)
			case 'generic':
			default:
				return formatMessage(messages.errGeneric)
		}
	}
	return e instanceof Error ? e.message : String(e)
}

async function submitPasswordLogin() {
	if (submitting.value || !canSubmitPassword.value) return
	submitting.value = true
	authenticating.value = false
	browserFlow.value = false
	errorMessage.value = ''
	try {
		await loginOwyxSite(loginInput.value, passwordInput.value)
		finish(true)
		emit('signedIn')
		modal.value?.hide()
	} catch (e) {
		if (!(e instanceof OwyxSiteAuthError && e.code === 'canceled')) {
			errorMessage.value = formatAuthError(e)
		}
	} finally {
		submitting.value = false
		passwordInput.value = ''
	}
}

async function submitBrowserLogin() {
	if (submitting.value) return
	submitting.value = true
	authenticating.value = true
	browserFlow.value = true
	errorMessage.value = ''
	browserUrl.value = ''
	browserOpened.value = null
	copiedUrl.value = false
	try {
		await loginOwyxSiteViaBrowser(undefined, (details) => {
			browserUrl.value = details.url
			browserOpened.value = details.opened
		})
		authenticating.value = false
		browserFlow.value = false
		finish(true)
		emit('signedIn')
		modal.value?.hide()
	} catch (e) {
		authenticating.value = false
		browserFlow.value = false
		browserUrl.value = ''
		if (!(e instanceof OwyxSiteAuthError && e.code === 'canceled')) {
			errorMessage.value = formatAuthError(e)
		}
	} finally {
		submitting.value = false
	}
}

function switchToPassword() {
	cancelOwyxSiteBrowserLogin()
	authenticating.value = false
	browserFlow.value = false
	submitting.value = false
	errorMessage.value = ''
	browserUrl.value = ''
	browserOpened.value = null
	copiedUrl.value = false
}

async function openBrowserUrl() {
	if (!browserUrl.value) return
	errorMessage.value = ''
	try {
		const opened = await reopenOwyxSiteBrowserLoginUrl(browserUrl.value)
		browserOpened.value = opened
		if (!opened) {
			errorMessage.value = formatMessage(messages.errBrowserOpen)
		}
	} catch {
		browserOpened.value = false
		errorMessage.value = formatMessage(messages.errBrowserOpen)
	}
}

async function copyBrowserUrl() {
	if (!browserUrl.value) return
	try {
		await navigator.clipboard.writeText(browserUrl.value)
		copiedUrl.value = true
		setTimeout(() => {
			copiedUrl.value = false
		}, 2000)
	} catch {
		/* clipboard write failed */
	}
}

function handleHide() {
	passwordInput.value = ''
	cancelOwyxSiteBrowserLogin()
	authenticating.value = false
	browserFlow.value = false
	submitting.value = false
	browserUrl.value = ''
	copiedUrl.value = false
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
			'Sign in with your Owyx account (username or email), or sign in via browser. Microsoft sign-in is optional for licensed skins.',
	},
	clientKeyHint: {
		id: 'modal.owyx-account-required.client-key-hint',
		defaultMessage: '',
	},
	loginLabel: {
		id: 'modal.owyx-account-required.login-label',
		defaultMessage: 'Username or email',
	},
	loginPlaceholder: {
		id: 'modal.owyx-account-required.login-placeholder',
		defaultMessage: 'Enter your nickname or email',
	},
	passwordLabel: {
		id: 'modal.owyx-account-required.password-label',
		defaultMessage: 'Password',
	},
	passwordPlaceholder: {
		id: 'modal.owyx-account-required.password-placeholder',
		defaultMessage: 'Enter your password',
	},
	showPasswordAria: {
		id: 'modal.owyx-account-required.show-password-aria',
		defaultMessage: 'Show password',
	},
	hidePasswordAria: {
		id: 'modal.owyx-account-required.hide-password-aria',
		defaultMessage: 'Hide password',
	},
	signInButton: {
		id: 'modal.owyx-account-required.sign-in-button',
		defaultMessage: 'Sign in',
	},
	orDivider: {
		id: 'modal.owyx-account-required.or-divider',
		defaultMessage: 'or',
	},
	createAccountButton: {
		id: 'modal.owyx-account-required.create-account-button',
		defaultMessage: 'Create an account',
	},
	browserSignInButton: {
		id: 'modal.owyx-account-required.browser-sign-in-button',
		defaultMessage: 'Sign in via owyx.site',
	},
	signingInButton: {
		id: 'modal.owyx-account-required.signing-in-button',
		defaultMessage: 'Signing in…',
	},
	waitingForBrowserSignIn: {
		id: 'modal.owyx-account-required.waiting-browser',
		defaultMessage: 'Finish sign-in in your browser…',
	},
	waitingForBrowserSignInBody: {
		id: 'modal.owyx-account-required.waiting-browser-body',
		defaultMessage: 'Sign in on owyx.site if needed, then return to the launcher.',
	},
	browserOpenStatusUnknown: {
		id: 'modal.owyx-account-required.browser-open-status-unknown',
		defaultMessage:
			'The launcher could not confirm that your browser opened. If no browser appeared, open the link below manually.',
	},
	manualUrlPrompt: {
		id: 'modal.owyx-account-required.manual-url-prompt',
		defaultMessage: 'Browser did not open? Open the link manually:',
	},
	browserManualUrlHint: {
		id: 'modal.owyx-account-required.browser-manual-url-hint',
		defaultMessage: 'If opening the link does not work, copy it and paste it into your browser.',
	},
	copyLinkButton: {
		id: 'modal.owyx-account-required.copy-link-button',
		defaultMessage: 'Copy link',
	},
	copiedLinkButton: {
		id: 'modal.owyx-account-required.copied-link-button',
		defaultMessage: 'Copied!',
	},
	openLinkButton: {
		id: 'modal.owyx-account-required.open-link-button',
		defaultMessage: 'Open in browser',
	},
	switchToPasswordButton: {
		id: 'modal.owyx-account-required.switch-to-password-button',
		defaultMessage: 'Use password instead',
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
	errInvalidCredentials: {
		id: 'modal.owyx-account-required.error.invalid-credentials',
		defaultMessage: 'Incorrect login or password.',
	},
	errAccessDenied: {
		id: 'modal.owyx-account-required.error.access-denied',
		defaultMessage: 'Account access denied. The account may be banned or inactive.',
	},
	errRateLimited: {
		id: 'modal.owyx-account-required.error.rate-limited',
		defaultMessage: 'Too many sign-in attempts. Please wait before trying again.',
	},
	errNetwork: {
		id: 'modal.owyx-account-required.error.network',
		defaultMessage: 'Could not reach Owyx servers. Check your internet connection.',
	},
	errBrowserOpen: {
		id: 'modal.owyx-account-required.error.browser-open',
		defaultMessage: 'Could not open the browser. Copy the link below and open it manually.',
	},
	errTimeout: {
		id: 'modal.owyx-account-required.error.timeout',
		defaultMessage: 'Sign-in timed out. Please try again.',
	},
	errGeneric: {
		id: 'modal.owyx-account-required.error.generic',
		defaultMessage: 'Sign-in failed. Please try again later.',
	},
})

defineExpose({
	show,
	showSigningIn,
})
</script>
