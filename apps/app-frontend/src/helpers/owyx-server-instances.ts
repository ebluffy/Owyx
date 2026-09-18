/**
 * Link curated Owyx catalog servers to local pack instances under profiles/servers/.
 */

import { join, tempDir } from '@tauri-apps/api/path'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	install_create_modpack_instance,
	installJobInstanceId,
	wait_for_install_job,
	type InstallJobSnapshot,
} from '@/helpers/install'
import { list } from '@/helpers/instance'
import type { OwyxServerEntry } from '@/helpers/owyx-api'
import { resolveOwyxPackUrl } from '@/helpers/owyx-api'
import type { GameInstance, InstanceLink } from '@/helpers/types'
import type { AppEvents } from '@/providers/app-events'

export const OWYX_SERVER_LINK_PREFIX = 'owyx-server:'

const STORAGE_KEY = 'owyx.serverInstanceMap'

type ServerInstanceMap = Record<string, string>

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

export function isOwyxServerInstance(instance: GameInstance): boolean {
	const link = instance.link
	if (link?.type === 'imported_modpack' && link.project_id?.startsWith(OWYX_SERVER_LINK_PREFIX)) {
		return true
	}
	if (instance.path === 'servers' || instance.path.startsWith('servers/')) {
		return true
	}
	return false
}

export function rememberOwyxServerInstance(serverId: string, instanceId: string) {
	const map = readMap()
	map[serverId] = instanceId
	writeMap(map)
}

export function forgetOwyxServerInstance(serverId: string) {
	const map = readMap()
	delete map[serverId]
	writeMap(map)
}

export async function findLinkedOwyxServerInstance(
	server: Pick<OwyxServerEntry, 'id' | 'name'>,
): Promise<GameInstance | null> {
	const map = readMap()
	const mappedId = map[server.id]
	const instances = await list()
	if (mappedId) {
		const hit = instances.find((i) => i.id === mappedId)
		if (hit) return hit
		forgetOwyxServerInstance(server.id)
	}
	const linkId = owyxServerLinkId(server.id)
	const byLink = instances.find(
		(i) =>
			i.link?.type === 'imported_modpack' &&
			i.link.project_id === linkId &&
			!isInstallingOnly(i),
	)
	if (byLink) {
		rememberOwyxServerInstance(server.id, byLink.id)
		return byLink
	}
	const byName = instances.find(
		(i) =>
			i.name === server.name &&
			isOwyxServerInstance(i) &&
			i.link?.type === 'imported_modpack' &&
			i.link.project_id === linkId,
	)
	return byName ?? null
}

function isInstallingOnly(instance: GameInstance): boolean {
	const stage = instance.install_stage
	return stage === 'not_installed' || stage === 'minecraft_installing' || stage === 'pack_installing'
}

function packFileExtension(url: string): string {
	const clean = url.split('?')[0]?.toLowerCase() ?? ''
	if (clean.endsWith('.mrpack')) return 'mrpack'
	if (clean.endsWith('.zip')) return 'zip'
	return 'mrpack'
}

export async function downloadOwyxPackToTemp(
	packUrl: string,
	serverId: string,
): Promise<string> {
	let res: Response
	try {
		res = await tauriFetch(packUrl, {
			method: 'GET',
			signal: AbortSignal.timeout(120_000),
		})
	} catch {
		res = await fetch(packUrl, {
			method: 'GET',
			signal: AbortSignal.timeout(120_000),
		})
	}
	if (!res.ok) {
		throw new Error(`Pack download failed (${res.status})`)
	}
	const buf = new Uint8Array(await res.arrayBuffer())
	if (buf.byteLength < 32) {
		throw new Error('Pack download was empty')
	}
	const dir = await join(await tempDir(), 'owyx-packs')
	await mkdir(dir, { recursive: true })
	const ext = packFileExtension(packUrl)
	const path = await join(dir, `${serverId}.${ext}`)
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

export async function installOwyxServerPack(
	server: OwyxServerEntry,
	apiBase: string,
	appEvents: AppEvents,
): Promise<{ instanceId: string; job: InstallJobSnapshot | null }> {
	const packUrl = resolveOwyxPackUrl(server.packUrl, apiBase)
	if (!packUrl) {
		throw new Error('No installable pack URL for this server')
	}
	const existing = await findLinkedOwyxServerInstance(server)
	if (existing && existing.install_stage === 'installed') {
		return { instanceId: existing.id, job: null }
	}

	const filePath = await downloadOwyxPackToTemp(packUrl, server.id)
	const filename = filePath.split(/[\\/]/).pop() ?? null
	const job = await install_create_modpack_instance(
		{ type: 'fromFile', path: filePath },
		{
			name: server.name,
			link: owyxServerInstanceLink(server, filename),
		},
	)
	const completed = await wait_for_install_job(appEvents, job.job_id)
	const instanceId = installJobInstanceId(completed)
	if (!instanceId) {
		throw new Error('Install finished without an instance id')
	}
	rememberOwyxServerInstance(server.id, instanceId)
	return { instanceId, job: completed }
}
