<script setup lang="ts">
import { CogIcon, PlayIcon, ServerStackIcon } from '@modrinth/assets'
import { Button, defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'
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
import { start_join_server } from '@/helpers/worlds'
import { injectAppEvents } from '@/providers/app-events'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import { injectOwyxSiteSession } from '@/providers/owyx-site-session'

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()
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
	copyAddress: { id: 'owyx.servers.copy-address', defaultMessage: 'Copy address' },
	refresh: { id: 'owyx.servers.refresh', defaultMessage: 'Refresh' },
	version: { id: 'owyx.servers.version', defaultMessage: 'MC {version}' },
	demoBadge: { id: 'owyx.servers.demo-badge', defaultMessage: 'demo' },
	playing: { id: 'owyx.servers.playing', defaultMessage: 'Preparing…' },
	downloadPack: { id: 'owyx.servers.download-pack', defaultMessage: 'Pack' },
	installPackFirst: {
		id: 'owyx.servers.install-pack-first',
		defaultMessage: 'Install the pack first (Pack or Play).',
	},
	noPackUrl: {
		id: 'owyx.servers.no-pack-url',
		defaultMessage: 'No installable pack is published for this server yet.',
	},
	packInstalled: {
		id: 'owyx.servers.pack-installed',
		defaultMessage: 'Pack installed for {name}.',
	},
})

useRootBreadcrumb({
	slot: 'root',
	id: 'owyx-servers',
	label: formatMessage(messages.title),
	to: '/owyx-servers',
	visual: { type: 'icon', component: ServerStackIcon },
})

const servers = ref<OwyxServerEntry[]>([])
const loading = ref(false)
const loadError = ref('')
const busyId = ref<string | null>(null)
const apiBase = ref(getStoredOwyxApiBase())
const copiedId = ref<string | null>(null)

const hasServers = computed(() => servers.value.length > 0)

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

async function openServerSettings(server: OwyxServerEntry) {
	try {
		const linked = await findLinkedOwyxServerInstance(server)
		if (!linked) {
			addNotification({
				type: 'warning',
				title: formatMessage(messages.settings),
				text: formatMessage(messages.installPackFirst),
			})
			return
		}
		await router.push(`/instance/${encodeURIComponent(linked.id)}/options`)
	} catch (e) {
		handleError(e)
	}
}

async function ensurePackInstalled(server: OwyxServerEntry): Promise<string | null> {
	if (!hasPack(server)) {
		addNotification({
			type: 'warning',
			title: formatMessage(messages.downloadPack),
			text: formatMessage(messages.noPackUrl),
		})
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

async function openPack(server: OwyxServerEntry) {
	busyId.value = server.id
	try {
		const instanceId = await ensurePackInstalled(server)
		if (!instanceId) return
		addNotification({
			type: 'success',
			title: formatMessage(messages.downloadPack),
			text: formatMessage(messages.packInstalled, { name: server.name }),
		})
	} catch (e) {
		handleError(e)
		const url = resolveOwyxPackUrl(server.packUrl, sanitizeOwyxApiBase(apiBase.value))
		if (url) window.open(url, '_blank', 'noopener,noreferrer')
	} finally {
		busyId.value = null
	}
}

async function playServer(server: OwyxServerEntry) {
	if (server.requiresAccount && !owyx.isSignedIn.value) {
		await owyx.signIn()
		if (!owyx.isSignedIn.value) return
	}
	busyId.value = server.id
	try {
		await navigator.clipboard.writeText(server.address).catch(() => undefined)
		const instanceId = await ensurePackInstalled(server)
		if (!instanceId) return
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
						<p class="m-0 mt-1 font-mono text-xs text-secondary">
							{{ server.address }}
							<span v-if="server.mcVersion">
								· {{ formatMessage(messages.version, { version: server.mcVersion }) }}
							</span>
						</p>
					</div>
				</div>
				<div class="flex shrink-0 flex-wrap gap-2">
					<Button class="!bg-button-bg" @click="copyAddress(server)">
						{{ copiedId === server.id ? '✓' : formatMessage(messages.copyAddress) }}
					</Button>
					<Button
						v-if="hasPack(server)"
						class="!bg-button-bg"
						:disabled="busyId === server.id"
						@click="openPack(server)"
					>
						{{ formatMessage(messages.downloadPack) }}
					</Button>
					<Button
						class="!bg-button-bg"
						:disabled="busyId === server.id"
						@click="openServerSettings(server)"
					>
						<CogIcon class="h-4 w-4" />
						{{ formatMessage(messages.settings) }}
					</Button>
					<Button
						type="colored"
						color="brand"
						:disabled="busyId === server.id"
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
	</div>
</template>
