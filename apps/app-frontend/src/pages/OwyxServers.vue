<script setup lang="ts">
import { PlayIcon, ServerStackIcon, SettingsIcon } from '@modrinth/assets'
import { Button, defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
	fetchOwyxCatalog,
	getOwyxClientKey,
	getOwyxDemoFlag,
	getOwyxLocalApiFallback,
	getStoredOwyxApiBase,
	isSafeExternalHttpsUrl,
	type OwyxServerEntry,
	resolveOwyxPackUrl,
	sanitizeOwyxApiBase,
} from '@/helpers/owyx-api'
import {
	findLinkedOwyxServerInstance,
	installOwyxServerPack,
} from '@/helpers/owyx-server-instances'
import type { GameInstance } from '@/helpers/types'
import {
	ensureManagedServerWorldExists,
	get_server_status,
	start_join_server,
} from '@/helpers/worlds'
import InstanceSettingsModal from '@/pages/instance/components/settings-modal/index.vue'
import { injectAppEvents } from '@/providers/app-events'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import { injectOwyxSiteSession } from '@/providers/owyx-site-session'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const router = useRouter()
const owyx = injectOwyxSiteSession()
const appEvents = injectAppEvents()

const messages = defineMessages({
	title: { id: 'owyx.servers.title', defaultMessage: 'Owyx Servers' },
	subtitle: {
		id: 'owyx.servers.subtitle',
		defaultMessage: 'Community and curated servers from the Owyx control plane.',
	},
	empty: {
		id: 'owyx.servers.empty',
		defaultMessage: 'No servers published yet. Check back later, or ask an admin to publish one.',
	},
	unreachable: {
		id: 'owyx.servers.unreachable',
		defaultMessage:
			'Could not reach the Owyx API. Check your connection, API base URL, and client key in Admin → API.',
	},
	loading: {
		id: 'owyx.servers.loading',
		defaultMessage: 'Loading servers…',
	},
	play: { id: 'owyx.servers.play', defaultMessage: 'Play' },
	settings: { id: 'owyx.servers.settings', defaultMessage: 'Settings' },
	settingsNeedInstall: {
		id: 'owyx.servers.settings-need-install',
		defaultMessage: 'Download the pack first (Play), then open Settings.',
	},
	settingsModalNotReady: {
		id: 'owyx.servers.settings-modal-not-ready',
		defaultMessage: 'Settings not ready yet — click Settings again in a moment.',
	},
	refresh: { id: 'owyx.servers.refresh', defaultMessage: 'Refresh' },
	version: { id: 'owyx.servers.version', defaultMessage: 'MC {version}' },
	demoBadge: { id: 'owyx.servers.demo-badge', defaultMessage: 'demo' },
	playing: { id: 'owyx.servers.playing', defaultMessage: 'Preparing…' },
	noPackUrl: {
		id: 'owyx.servers.no-pack-url',
		defaultMessage: 'No pack download URL for this server',
	},
	copyAddress: { id: 'owyx.servers.copy-address', defaultMessage: 'Copy address' },
	statusOnline: { id: 'owyx.servers.status.online', defaultMessage: 'Online' },
	statusOffline: { id: 'owyx.servers.status.offline', defaultMessage: 'Offline' },
	statusChecking: { id: 'owyx.servers.status.checking', defaultMessage: 'Checking…' },
	statusPing: { id: 'owyx.servers.status.ping', defaultMessage: '{ms} ms' },
})

useRootBreadcrumb({
	slot: 'root',
	id: 'owyx-servers',
	label: formatMessage(messages.title),
	to: '/owyx-servers',
	visual: { type: 'icon', component: ServerStackIcon },
})

type ServerLiveStatus = {
	online: boolean
	ping?: number
	players?: string
	checking?: boolean
}

const servers = ref<OwyxServerEntry[]>([])
const loading = ref(false)
const loadError = ref('')
const busyId = ref<string | null>(null)
const apiBase = ref(getStoredOwyxApiBase())
const copiedId = ref<string | null>(null)
const liveStatus = ref<Record<string, ServerLiveStatus>>({})
const linkedInstanceIds = ref<Record<string, string>>({})
const settingsInstance = ref<GameInstance | null>(null)
const settingsModal = ref<InstanceType<typeof InstanceSettingsModal> | null>(null)
let statusTimer: ReturnType<typeof setInterval> | null = null
let unsubscribeInstanceEvents: (() => void) | null = null

const hasServers = computed(() => servers.value.length > 0)

async function refreshLinkedMap() {
	const next: Record<string, string> = {}
	await Promise.all(
		servers.value.map(async (server) => {
			try {
				const inst = await findLinkedOwyxServerInstance(server)
				if (inst) next[server.id] = inst.id
			} catch {
				/* ignore */
			}
		}),
	)
	linkedInstanceIds.value = next
}

function hasLinkedInstance(server: OwyxServerEntry): boolean {
	return Boolean(linkedInstanceIds.value[server.id])
}

async function openServerSettings(server: OwyxServerEntry) {
	try {
		const inst = await findLinkedOwyxServerInstance(server)
		if (!inst) {
			handleError(new Error(formatMessage(messages.settingsNeedInstall)))
			return
		}
		settingsInstance.value = inst
		// Wait for Vue to mount the settings modal with the new instance (#128 review).
		await nextTick()
		if (!settingsModal.value) {
			// Instance just linked but the modal hasn't mounted yet — let the user retry.
			handleError(new Error(formatMessage(messages.settingsModalNotReady)))
			return
		}
		settingsModal.value.show()
	} catch (e) {
		handleError(e)
	}
}

async function loadCatalog() {
	loading.value = true
	loadError.value = ''
	try {
		const result = await fetchOwyxCatalog({
			baseUrl: sanitizeOwyxApiBase(apiBase.value),
			clientKey: getOwyxClientKey(),
			authToken: owyx.session.value?.token,
			demoFallback: getOwyxDemoFlag(),
			allowLocalFallback: getOwyxLocalApiFallback(),
		})
		servers.value = result.servers
		apiBase.value = getStoredOwyxApiBase()
		if (result.fromFallback && result.servers.length === 0) {
			loadError.value = formatMessage(messages.unreachable)
		}
		void refreshAllStatuses()
		void refreshLinkedMap()
	} catch (e) {
		servers.value = []
		loadError.value = e instanceof Error ? e.message : String(e)
		handleError(e)
	} finally {
		loading.value = false
	}
}

async function copyAddress(server: OwyxServerEntry) {
	try {
		await navigator.clipboard.writeText(server.address)
		copiedId.value = server.id
		setTimeout(() => {
			if (copiedId.value === server.id) copiedId.value = null
		}, 1500)
	} catch (e) {
		handleError(e)
	}
}

function hasPack(server: OwyxServerEntry): boolean {
	return Boolean(resolveOwyxPackUrl(server.packUrl, sanitizeOwyxApiBase(apiBase.value)))
}

async function pingOne(server: OwyxServerEntry) {
	liveStatus.value = {
		...liveStatus.value,
		[server.id]: { ...(liveStatus.value[server.id] ?? { online: false }), checking: true },
	}
	try {
		const status = await get_server_status(server.address)
		const online = Boolean(status)
		const players =
			status?.players?.online != null && status?.players?.max != null
				? `${status.players.online}/${status.players.max}`
				: undefined
		liveStatus.value = {
			...liveStatus.value,
			[server.id]: {
				online,
				ping: typeof status?.ping === 'number' ? Math.round(status.ping) : undefined,
				players,
				checking: false,
			},
		}
	} catch {
		liveStatus.value = {
			...liveStatus.value,
			[server.id]: { online: false, checking: false },
		}
	}
}

async function refreshAllStatuses() {
	await Promise.all(servers.value.map((s) => pingOne(s)))
}

async function ensurePackInstalled(server: OwyxServerEntry): Promise<string | null> {
	if (!hasPack(server)) {
		handleError(new Error(formatMessage(messages.noPackUrl)))
		return null
	}
	const existing = await findLinkedOwyxServerInstance(server)
	if (existing?.install_stage === 'installed') {
		return existing.id
	}
	const { instanceId } = await installOwyxServerPack(
		server,
		sanitizeOwyxApiBase(apiBase.value),
		appEvents,
	)
	return instanceId
}

async function playServer(server: OwyxServerEntry) {
	if (owyx.isSignedIn.value && owyx.session.value?.user.serverAccess === false) {
		handleError(new Error(owyx.session.value.user.accessReason || 'Owyx server access is unavailable'))
		return
	}
	if (server.requiresAccount && !owyx.isSignedIn.value) {
		await owyx.signIn()
		if (!owyx.isSignedIn.value) return
	}
	busyId.value = server.id
	try {
		await navigator.clipboard.writeText(server.address).catch(() => undefined)
		const instanceId = await ensurePackInstalled(server)
		if (!instanceId) return
		await refreshLinkedMap()
		await ensureManagedServerWorldExists(instanceId, server.name, server.address)
		try {
			await start_join_server(instanceId, server.address)
		} catch {
			await router.push(`/instance/${encodeURIComponent(instanceId)}`)
		}
	} catch (e) {
		handleError(e)
	} finally {
		busyId.value = null
	}
}

onMounted(() => {
	void loadCatalog()
	statusTimer = setInterval(() => {
		// Don't burn pings while the window is hidden (#128 review).
		if (typeof document !== 'undefined' && document.hidden) return
		void refreshAllStatuses()
	}, 15_000)
	document.addEventListener('visibilitychange', onVisibilityChange)
	// Library changes (install/uninstall/delete) invalidate the linked-instance map.
	unsubscribeInstanceEvents = appEvents.on('instance', () => {
		void refreshLinkedMap()
	})
})

function onVisibilityChange() {
	if (document.hidden) return
	// Refresh immediately when the user returns to the window.
	void refreshAllStatuses()
}

onUnmounted(() => {
	if (statusTimer) clearInterval(statusTimer)
	document.removeEventListener('visibilitychange', onVisibilityChange)
	unsubscribeInstanceEvents?.()
})
</script>

<template>
	<div class="owyx-servers mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
		<header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 class="m-0 text-2xl font-semibold text-contrast">
					{{ formatMessage(messages.title) }}
				</h1>
				<p class="m-0 text-secondary">{{ formatMessage(messages.subtitle) }}</p>
			</div>
			<Button class="!bg-button-bg" :disabled="loading" @click="loadCatalog">
				{{ formatMessage(messages.refresh) }}
			</Button>
		</header>

		<section v-if="loading" class="text-secondary animate-pulse">
			{{ formatMessage(messages.loading) }}
		</section>

		<section
			v-else-if="loadError && !hasServers"
			class="rounded-xl border border-dashed border-surface-5 bg-surface-2 p-8 text-center text-secondary"
		>
			<p class="m-0">{{ formatMessage(messages.unreachable) }}</p>
			<p class="m-0 mt-2 text-xs opacity-80">{{ loadError }}</p>
			<Button class="mt-4" @click="loadCatalog">{{ formatMessage(messages.refresh) }}</Button>
		</section>

		<section
			v-else-if="!hasServers"
			class="rounded-xl border border-dashed border-surface-5 bg-surface-2 p-8 text-center text-secondary"
		>
			{{ formatMessage(messages.empty) }}
		</section>

		<ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
			<li
				v-for="server in servers"
				:key="server.id"
				class="flex flex-col gap-3 rounded-xl border border-solid border-surface-5 bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex min-w-0 items-start gap-3">
					<img
						v-if="server.iconUrl && isSafeExternalHttpsUrl(server.iconUrl)"
						:src="
							server.iconUrl.startsWith('/')
								? `${sanitizeOwyxApiBase(apiBase)}${server.iconUrl}`
								: server.iconUrl
						"
						alt=""
						class="h-12 w-12 shrink-0 rounded-lg object-cover"
					/>
					<div
						v-else
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-brand"
					>
						<ServerStackIcon class="h-6 w-6" />
					</div>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="m-0 truncate text-lg font-semibold text-contrast">{{ server.name }}</h2>
							<span
								v-if="server.demo"
								class="rounded bg-brand/10 px-1.5 py-0.5 text-xs uppercase tracking-wide text-brand"
							>
								{{ formatMessage(messages.demoBadge) }}
							</span>
						</div>
						<p class="m-0 mt-1 text-sm text-secondary">{{ server.description }}</p>
						<p
							class="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-secondary"
						>
							<button
								type="button"
								class="cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit underline decoration-dotted underline-offset-2 hover:text-primary"
								:title="formatMessage(messages.copyAddress)"
								@click="copyAddress(server)"
							>
								{{ server.address }}
								<span v-if="copiedId === server.id" class="text-brand no-underline"> ✓</span>
							</button>
							<span
								class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-sans"
								:class="
									liveStatus[server.id]?.online
										? 'bg-green/15 text-green'
										: liveStatus[server.id]?.checking
											? 'bg-surface-3 text-secondary'
											: 'bg-red/15 text-red'
								"
							>
								<span
									class="size-1.5 rounded-full"
									:class="
										liveStatus[server.id]?.online
											? 'bg-green'
											: liveStatus[server.id]?.checking
												? 'bg-secondary'
												: 'bg-red'
									"
								/>
								<template v-if="liveStatus[server.id]?.checking">
									{{ formatMessage(messages.statusChecking) }}
								</template>
								<template v-else-if="liveStatus[server.id]?.online">
									{{ formatMessage(messages.statusOnline) }}
									<span v-if="liveStatus[server.id]?.ping != null">
										·
										{{ formatMessage(messages.statusPing, { ms: liveStatus[server.id].ping }) }}
									</span>
									<span v-if="liveStatus[server.id]?.players">
										· {{ liveStatus[server.id].players }}
									</span>
								</template>
								<template v-else>
									{{ formatMessage(messages.statusOffline) }}
								</template>
							</span>
							<span v-if="server.mcVersion">
								· {{ formatMessage(messages.version, { version: server.mcVersion }) }}
							</span>
						</p>
					</div>
				</div>
				<div class="flex shrink-0 flex-wrap gap-2">
					<Button
						class="!bg-button-bg"
						:disabled="busyId === server.id || !hasLinkedInstance(server)"
						:title="
							hasLinkedInstance(server)
								? formatMessage(messages.settings)
								: formatMessage(messages.settingsNeedInstall)
						"
						@click="openServerSettings(server)"
					>
						<SettingsIcon class="h-4 w-4" />
						{{ formatMessage(messages.settings) }}
					</Button>
					<Button
						type="colored"
						color="brand"
						:disabled="busyId === server.id || !hasPack(server)"
						@click="playServer(server)"
					>
						<PlayIcon class="h-4 w-4" />
						{{
							busyId === server.id ? formatMessage(messages.playing) : formatMessage(messages.play)
						}}
					</Button>
				</div>
			</li>
		</ul>

		<InstanceSettingsModal
			v-if="settingsInstance"
			ref="settingsModal"
			:instance="settingsInstance"
			@unlinked="settingsInstance = null"
		/>
	</div>
</template>
