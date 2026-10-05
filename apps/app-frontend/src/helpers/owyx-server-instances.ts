/**
 * Link curated Owyx catalog servers to local pack instances under profiles/servers/.
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	install_create_modpack_instance,
	install_pack_to_existing_instance,
	installJobInstanceId,
	type InstallJobSnapshot,
	wait_for_install_job,
} from '@/helpers/install'
import { list } from '@/helpers/instance'
import {
	getOwyxClientKey,
	isOwyxReuseParentPackEnabled,
	type OwyxServerEntry,
	resolveOwyxPackUrl,
} from '@/helpers/owyx-api'
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
 * Find a non-server library instance that matches this catalog server's
 * Minecraft version + loader (E1 foundation — opt-in via localStorage).
 */
export async function findReusableLibraryParent(
	server: Pick<OwyxServerEntry, 'mcVersion' | 'loader' | 'id'>,
): Promise<GameInstance | null> {
	if (!isOwyxReuseParentPackEnabled()) return null
	const mc = (server.mcVersion || '').trim()
	const loader = (server.loader || '').trim().toLowerCase()
	if (!mc) return null
	const instances = await list()
	const hit = instances.find((inst) => {
		if (isOwyxServerInstance(inst)) return false
		if (inst.install_stage !== 'installed') return false
		if (inst.game_version !== mc) return false
		if (loader && String(inst.loader || '').toLowerCase() !== loader) return false
		return true
	})
	return hit ?? null
}

async function sha256HexOfFile(path: string): Promise<string> {
	const bytes = await readFile(path)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Cache curated packs under app data `owyx-packs/` (in Tauri fs scope).
 * Reuses the cached file only when Content-Length matches, and packSha256
 * matches when provided. Without length (and without sha) — always re-download.
 */
export async function downloadOwyxPackToTemp(
	packUrl: string,
	serverId: string,
	expectedSha256?: string | null,
): Promise<string> {
	const headers = packDownloadHeaders(packUrl)
	/** Keep in sync with owyxsite `MAX_PACK_BYTES` (512 MB). */
	const MAX_PACK_BYTES = 512 * 1024 * 1024
	const dir = await join(await appDataDir(), 'owyx-packs')
	await mkdir(dir, { recursive: true })
	const ext = packFileExtension(packUrl)
	const path = await join(dir, `${sanitizePackFileId(serverId)}.${ext}`)
	const wantSha = expectedSha256?.trim().toLowerCase() || ''

	// E1: skip re-download only when we can prove the cache is complete.
	try {
		if (await exists(path)) {
			const fileStat = await stat(path)
			let expected = 0
			try {
				const head = await tauriFetch(packUrl, {
					method: 'HEAD',
					headers,
					signal: AbortSignal.timeout(15_000),
				})
				expected = Number(head.headers.get('content-length') || 0)
			} catch {
				expected = 0
			}
			if (fileStat.size >= 32) {
				if (Number.isFinite(expected) && expected > 0 && fileStat.size !== expected) {
					await remove(path).catch(() => undefined)
				} else if (wantSha) {
					const got = await sha256HexOfFile(path)
					if (got === wantSha) return path
					await remove(path).catch(() => undefined)
				} else if (Number.isFinite(expected) && expected > 0 && fileStat.size === expected) {
					// Size matches Content-Length; no sha available in catalog yet.
					return path
				}
				// No Content-Length and no sha → never trust the cache.
			}
		}
	} catch {
		/* fall through to download */
	}

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
	const contentLength = Number(res.headers.get('content-length') || 0)
	if (Number.isFinite(contentLength) && contentLength > MAX_PACK_BYTES) {
		throw new Error(
			`Pack is too large (${Math.round(contentLength / (1024 * 1024))} MB). Max ${Math.round(MAX_PACK_BYTES / (1024 * 1024))} MB.`,
		)
	}
	const body = res.body
	if (!body) throw new Error('Pack download returned no body')

	let totalBytes = 0
	try {
		const reader = body.getReader()
		const limitedBody = new ReadableStream<Uint8Array>({
			async pull(controller) {
				const { done, value } = await reader.read()
				if (done) {
					controller.close()
					return
				}
				if (!value?.byteLength) return
				totalBytes += value.byteLength
				if (totalBytes > MAX_PACK_BYTES) {
					controller.error(
						new Error(
							`Pack is too large (${Math.round(totalBytes / (1024 * 1024))} MB). Max ${Math.round(MAX_PACK_BYTES / (1024 * 1024))} MB.`,
						),
					)
					return
				}
				controller.enqueue(value)
			},
			cancel(reason) {
				return reader.cancel(reason)
			},
		})
		try {
			await writeFile(path, limitedBody)
		} finally {
			reader.releaseLock()
		}
		if (totalBytes < 32) throw new Error('Pack download was empty')
		if (Number.isFinite(contentLength) && contentLength > 0 && totalBytes !== contentLength) {
			throw new Error(`Pack download incomplete (${totalBytes} bytes, expected ${contentLength})`)
		}
		if (wantSha) {
			const got = await sha256HexOfFile(path)
			if (got !== wantSha) {
				throw new Error('Pack sha256 mismatch after download')
			}
		}
		return path
	} catch (error) {
		await remove(path).catch(() => undefined)
		throw error
	}
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

	// E1 foundation: detect a reusable library parent (flagged). Full hardlink /
	// hash-diff install is unfinished — we still download the pack (cache-aware).
	const reusableParent = await findReusableLibraryParent(server)
	if (reusableParent) {
		console.info(
			`[owyx E1] reusable library instance ${reusableParent.id} matches ${server.id}; ` +
				'full “use my pack” hardlink path not finished — installing pack with cache reuse',
		)
	}

	const filePath = await downloadOwyxPackToTemp(packUrl, server.id, server.packSha256)
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
