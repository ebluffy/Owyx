/**
 * Link curated Owyx catalog servers to local pack instances under profiles/servers/.
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	install_create_modpack_instance,
	install_pack_to_existing_instance,
	installJobInstanceId,
	type InstallJobSnapshot,
	wait_for_install_job,
} from '@/helpers/install'
import { list } from '@/helpers/instance'
import { getOwyxClientKey, type OwyxServerEntry, resolveOwyxPackUrl } from '@/helpers/owyx-api'
import { getStoredOwyxSiteSession } from '@/helpers/owyx-site-auth'
import type { GameInstance, InstanceLink } from '@/helpers/types'
import type { AppEvents } from '@/providers/app-events'

export const OWYX_SERVER_LINK_PREFIX = 'owyx-server:'

const STORAGE_KEY = 'owyx.serverInstanceMap'

type ServerInstanceMap = Record<string, string>

/** In-flight installs keyed by catalog server id — collapses double-click races. */
const inflightInstalls = new Map<
	string,
	Promise<{ instanceId: string; job: InstallJobSnapshot | null }>
>()

function readMap(): ServerInstanceMap {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== 'object') return {}
		return parsed as ServerInstanceMap
	} catch {
		return {}
	}
}

function writeMap(map: ServerInstanceMap) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function owyxServerLinkId(serverId: string): string {
	return `${OWYX_SERVER_LINK_PREFIX}${serverId}`
}

function sanitizePackFileId(serverId: string): string {
	return serverId.replace(/[^A-Za-z0-9_\-.]/g, '_').slice(0, 64) || 'server'
}

export function isOwyxServerInstance(instance: GameInstance): boolean {
	const link = instance.link
	return (
		link?.type === 'imported_modpack' &&
		Boolean(link.project_id?.startsWith(OWYX_SERVER_LINK_PREFIX))
	)
}

export function rememberOwyxServerInstance(serverId: string, instanceId: string) {
	const map = readMap()
	map[serverId] = instanceId
	writeMap(map)
}

export function forgetOwyxServerInstance(serverId: string) {
	const map = readMap()
	const { [serverId]: _removed, ...rest } = map
	writeMap(rest)
}

export async function findLinkedOwyxServerInstance(
	server: Pick<OwyxServerEntry, 'id' | 'name'>,
): Promise<GameInstance | null> {
	const map = readMap()
	const mappedId = map[server.id]
	const instances = await list()
	const linkId = owyxServerLinkId(server.id)

	const candidates = instances.filter(
		(i) =>
			i.id === mappedId || (i.link?.type === 'imported_modpack' && i.link.project_id === linkId),
	)
	if (!candidates.length) {
		if (mappedId) forgetOwyxServerInstance(server.id)
		return null
	}

	const installed = candidates.find((i) => i.install_stage === 'installed')
	const preferred =
		installed ?? candidates.find((i) => isInstallingStage(i.install_stage)) ?? candidates[0]

	if (preferred.install_stage === 'installed') {
		rememberOwyxServerInstance(server.id, preferred.id)
	}
	return preferred
}

function isInstallingStage(stage: GameInstance['install_stage']): boolean {
	return (
		stage === 'minecraft_installing' || stage === 'pack_installing' || stage === 'pack_installed'
	)
}

function packFileExtension(url: string): string {
	const clean = url.split('?')[0]?.toLowerCase() ?? ''
	if (clean.endsWith('.mrpack')) return 'mrpack'
	if (clean.endsWith('.zip')) return 'zip'
	return 'mrpack'
}

function packDownloadHeaders(packUrl: string): HeadersInit | undefined {
	try {
		const host = new URL(packUrl).hostname.toLowerCase()
		if (
			host === 'api.owyx.site' ||
			host === 'owyx.site' ||
			host.endsWith('.owyx.site') ||
			host === '127.0.0.1' ||
			host === 'localhost'
		) {
			const headers: Record<string, string> = {}
			const key = getOwyxClientKey().trim()
			if (key) headers['X-Owyx-Client-Key'] = key
			const token = getStoredOwyxSiteSession()?.token?.trim()
			if (token) headers.Authorization = `Bearer ${token}`
			return Object.keys(headers).length ? headers : undefined
		}
	} catch {
		/* ignore */
	}
	return undefined
}

/**
 * Cache curated packs under app data `owyx-packs/` (in Tauri fs scope).
 */
export async function downloadOwyxPackToTemp(packUrl: string, serverId: string): Promise<string> {
	const headers = packDownloadHeaders(packUrl)
	let res: Response
	try {
		res = await tauriFetch(packUrl, {
			method: 'GET',
			headers,
			signal: AbortSignal.timeout(120_000),
		})
	} catch {
		res = await fetch(packUrl, {
			method: 'GET',
			headers,
			signal: AbortSignal.timeout(120_000),
		})
	}
	if (!res.ok) {
		throw new Error(`Pack download failed (${res.status})`)
	}
	/** Keep in sync with owyxsite `MAX_PACK_BYTES` (512 MB). */
	const MAX_PACK_BYTES = 512 * 1024 * 1024
	const contentLength = Number(res.headers.get('content-length') || 0)
	if (Number.isFinite(contentLength) && contentLength > MAX_PACK_BYTES) {
		throw new Error(
			`Pack is too large (${Math.round(contentLength / (1024 * 1024))} MB). Max ${Math.round(MAX_PACK_BYTES / (1024 * 1024))} MB.`,
		)
	}
	const buf = new Uint8Array(await res.arrayBuffer())
	if (buf.byteLength < 32) {
		throw new Error('Pack download was empty')
	}
	if (buf.byteLength > MAX_PACK_BYTES) {
		throw new Error(
			`Pack is too large (${Math.round(buf.byteLength / (1024 * 1024))} MB). Max ${Math.round(MAX_PACK_BYTES / (1024 * 1024))} MB.`,
		)
	}
	const dir = await join(await appDataDir(), 'owyx-packs')
	await mkdir(dir, { recursive: true })
	const ext = packFileExtension(packUrl)
	const path = await join(dir, `${sanitizePackFileId(serverId)}.${ext}`)
	await writeFile(path, buf)
	return path
}

export function owyxServerInstanceLink(
	server: OwyxServerEntry,
	filename?: string | null,
): InstanceLink {
	return {
		type: 'imported_modpack',
		project_id: owyxServerLinkId(server.id),
		version_id: null,
		name: server.name,
		version_number: server.mcVersion ?? null,
		filename: filename ?? null,
	}
}

async function waitUntilInstalled(instanceId: string): Promise<GameInstance> {
	for (let i = 0; i < 180; i++) {
		const instances = await list()
		const hit = instances.find((item) => item.id === instanceId)
		if (!hit) {
			throw new Error('Server pack instance disappeared during install')
		}
		if (hit.install_stage === 'installed') return hit
		if (!isInstallingStage(hit.install_stage)) {
			return hit
		}
		await new Promise((r) => setTimeout(r, 1000))
	}
	throw new Error('Timed out waiting for server pack install')
}

async function installOwyxServerPackInner(
	server: OwyxServerEntry,
	apiBase: string,
	appEvents: AppEvents,
): Promise<{ instanceId: string; job: InstallJobSnapshot | null }> {
	const packUrl = resolveOwyxPackUrl(server.packUrl, apiBase)
	if (!packUrl) {
		throw new Error('No installable pack URL for this server')
	}
	const existing = await findLinkedOwyxServerInstance(server)
	if (existing?.install_stage === 'installed') {
		return { instanceId: existing.id, job: null }
	}
	if (existing && isInstallingStage(existing.install_stage)) {
		const finished = await waitUntilInstalled(existing.id)
		if (finished.install_stage === 'installed') {
			rememberOwyxServerInstance(server.id, finished.id)
			return { instanceId: finished.id, job: null }
		}
	}

	const filePath = await downloadOwyxPackToTemp(packUrl, server.id)
	const filename = filePath.split(/[\\/]/).pop() ?? null
	const link = owyxServerInstanceLink(server, filename)
	const postEdit = {
		name: server.name,
		link,
	}

	try {
		let job: InstallJobSnapshot
		if (existing) {
			job = await install_pack_to_existing_instance(
				existing.id,
				{ type: 'fromFile', path: filePath },
				postEdit,
			)
		} else {
			job = await install_create_modpack_instance({ type: 'fromFile', path: filePath }, postEdit)
		}

		const completed = await wait_for_install_job(appEvents, job.job_id)
		const instanceId = installJobInstanceId(completed) ?? existing?.id ?? null
		if (!instanceId) {
			throw new Error('Install finished without an instance id')
		}
		rememberOwyxServerInstance(server.id, instanceId)
		return { instanceId, job: completed }
	} catch (error) {
		forgetOwyxServerInstance(server.id)
		throw error
	}
}

export async function installOwyxServerPack(
	server: OwyxServerEntry,
	apiBase: string,
	appEvents: AppEvents,
): Promise<{ instanceId: string; job: InstallJobSnapshot | null }> {
	const existing = inflightInstalls.get(server.id)
	if (existing) return existing

	const pending = installOwyxServerPackInner(server, apiBase, appEvents).finally(() => {
		inflightInstalls.delete(server.id)
	})
	inflightInstalls.set(server.id, pending)
	return pending
}
