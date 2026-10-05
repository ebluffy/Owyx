/**
 * Link curated Owyx catalog servers to local pack instances under profiles/servers/.
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { exists, mkdir, remove, stat, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	install_create_modpack_instance,
	install_duplicate_instance,
	install_pack_to_existing_instance,
	installJobInstanceId,
	type InstallJobSnapshot,
	wait_for_install_job,
} from '@/helpers/install'
import { edit, list, remove as removeInstance } from '@/helpers/instance'
import {
	getOwyxClientKey,
	isOwyxReuseParentPackEnabled,
	type OwyxServerEntry,
	resolveOwyxPackUrl,
} from '@/helpers/owyx-api'
import { getStoredOwyxSiteSession } from '@/helpers/owyx-site-auth'
import type { GameInstance, InstanceLink } from '@/helpers/types'
import type { AppEvents } from '@/providers/app-events'
import { ref, type Ref } from 'vue'

export const OWYX_SERVER_LINK_PREFIX = 'owyx-server:'

const STORAGE_KEY = 'owyx.serverInstanceMap'
const PACK_META_KEY = 'owyx.serverPackMeta'

type ServerInstanceMap = Record<string, string>
type ServerPackMeta = { sha256?: string; version?: string; updatedAt: number }

function readPackMetaMap(): Record<string, ServerPackMeta> {
	try {
		const raw = localStorage.getItem(PACK_META_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as Record<string, ServerPackMeta>
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function writePackMetaMap(map: Record<string, ServerPackMeta>) {
	owyxServerPackMeta.value = { ...map }
	localStorage.setItem(PACK_META_KEY, JSON.stringify(map))
}

/** Reactive pack-meta map so UI badges update after install/seed (E2-c). */
export const owyxServerPackMeta: Ref<Record<string, ServerPackMeta>> = ref(readPackMetaMap())

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
 * Find a library instance to reuse for this catalog server (E1).
 * Opt-in via localStorage `owyx.reuseParentPack=1`.
 * Matches **only** admin-device parent hints stored at publish time
 * (`owyx.packParentHint:<packId>`), never by loose MC+loader and never
 * from the public catalog (admin instance ids are not portable).
 */
export async function findReusableLibraryParent(
	server: Pick<OwyxServerEntry, 'id' | 'packId'>,
): Promise<GameInstance | null> {
	if (!isOwyxReuseParentPackEnabled()) return null
	const packKey = (server.packId || server.id || '').trim()
	if (!packKey) return null
	let hint = ''
	try {
		hint = localStorage.getItem(`owyx.packParentHint:${packKey}`)?.trim() || ''
	} catch {
		hint = ''
	}
	if (!hint) return null
	const instances = await list()
	const hit = instances.find((inst) => {
		if (isOwyxServerInstance(inst)) return false
		if (inst.install_stage !== 'installed') return false
		return inst.id === hint
	})
	return hit ?? null
}

/** Remember which library instance published a pack (admin device only, E1). */
export function rememberPackParentHint(packId: string, instanceId: string) {
	const id = packId?.trim()
	const inst = instanceId?.trim()
	if (!id || !inst) return
	try {
		localStorage.setItem(`owyx.packParentHint:${id}`, inst)
	} catch {
		/* ignore quota */
	}
}

export function rememberInstalledPackMeta(
	serverId: string,
	meta: { sha256?: string | null; version?: string | null },
) {
	const map = { ...owyxServerPackMeta.value }
	map[serverId] = {
		sha256: meta.sha256?.trim().toLowerCase() || undefined,
		version: meta.version?.trim() || undefined,
		updatedAt: Date.now(),
	}
	writePackMetaMap(map)
}

/**
 * Seed local pack meta for pre-E2 installs (E2-c / P3-f).
 * Prefer marking `__unknown__` over trusting a cache file that may already
 * be the newer (not-yet-installed) catalog revision.
 */
export async function seedPackMetaFromCache(server: OwyxServerEntry): Promise<void> {
	if (owyxServerPackMeta.value[server.id]) return
	const linked = await findLinkedOwyxServerInstance(server)
	if (!linked || linked.install_stage !== 'installed') return

	if (server.packSha256 || server.packVersion) {
		rememberInstalledPackMeta(server.id, {
			sha256: undefined,
			version: '__unknown__',
		})
	}
}

/** True when catalog pack sha/version differs from what this device last installed. */
export function isOwyxServerPackUpdateAvailable(
	server: Pick<OwyxServerEntry, 'id' | 'packSha256' | 'packVersion'>,
): boolean {
	const prev = owyxServerPackMeta.value[server.id]
	if (!prev) return false
	if (prev.version === '__unknown__') return true
	const wantSha = server.packSha256?.trim().toLowerCase() || ''
	const wantVer = server.packVersion?.trim() || ''
	if (wantSha && prev.sha256 && wantSha !== prev.sha256) return true
	if (wantVer && prev.version && wantVer !== prev.version) return true
	return false
}

/** Stream SHA-256 via Rust (P3) — does not load the whole pack into JS heap. */
async function sha256HexOfFile(path: string): Promise<string> {
	const hex = await invoke<string>('plugin:utils|owyx_sha256_file', { path })
	return String(hex || '').toLowerCase()
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
	opts?: { allowUpdate?: boolean },
): Promise<{ instanceId: string; job: InstallJobSnapshot | null }> {
	const packUrl = resolveOwyxPackUrl(server.packUrl, apiBase)
	if (!packUrl) {
		throw new Error('No installable pack URL for this server')
	}
	const existing = await findLinkedOwyxServerInstance(server)
	const wantsUpdate =
		Boolean(existing?.install_stage === 'installed') && isOwyxServerPackUpdateAvailable(server)
	if (existing?.install_stage === 'installed' && wantsUpdate && !opts?.allowUpdate) {
		// E2-d: do not silently overwrite player configs — caller must confirm.
		return { instanceId: existing.id, job: null }
	}
	if (existing?.install_stage === 'installed' && !wantsUpdate) {
		return { instanceId: existing.id, job: null }
	}
	if (existing && isInstallingStage(existing.install_stage)) {
		const finished = await waitUntilInstalled(existing.id)
		if (finished.install_stage === 'installed') {
			rememberOwyxServerInstance(server.id, finished.id)
			return { instanceId: finished.id, job: null }
		}
	}

	const filePath = await downloadOwyxPackToTemp(packUrl, server.id, server.packSha256)
	const filename = filePath.split(/[\\/]/).pop() ?? null
	const link = owyxServerInstanceLink(server, filename)
	const postEdit = {
		name: server.name,
		link,
	}

	let orphanDupId: string | null = null
	try {
		let job: InstallJobSnapshot
		const reusableParent = await findReusableLibraryParent(server)
		if (reusableParent && !existing) {
			// E1: duplicate parent (content-store hardlinks for managed mods), then
			// apply the catalog pack for hash-diff materialization of changed files.
			console.info(
				`[owyx E1] reusing library instance ${reusableParent.id} for ${server.id} via duplicate + pack apply`,
			)
			const dupJob = await install_duplicate_instance(reusableParent.id)
			const dupDone = await wait_for_install_job(appEvents, dupJob.job_id)
			const dupId = installJobInstanceId(dupDone)
			if (!dupId) {
				throw new Error('Duplicate finished without an instance id')
			}
			orphanDupId = dupId
			await edit(dupId, postEdit)
			job = await install_pack_to_existing_instance(
				dupId,
				{ type: 'fromFile', path: filePath },
				postEdit,
			)
		} else if (existing) {
			job = await install_pack_to_existing_instance(
				existing.id,
				{ type: 'fromFile', path: filePath },
				postEdit,
			)
		} else {
			job = await install_create_modpack_instance({ type: 'fromFile', path: filePath }, postEdit)
		}

		const completed = await wait_for_install_job(appEvents, job.job_id)
		const instanceId = installJobInstanceId(completed) ?? existing?.id ?? orphanDupId ?? null
		if (!instanceId) {
			throw new Error('Install finished without an instance id')
		}
		orphanDupId = null
		rememberOwyxServerInstance(server.id, instanceId)
		rememberInstalledPackMeta(server.id, {
			sha256: server.packSha256,
			version: server.packVersion,
		})
		return { instanceId, job: completed }
	} catch (error) {
		// E2-e: only forget a brand-new link; keep existing server→instance mapping on failed update.
		if (!existing) {
			forgetOwyxServerInstance(server.id)
		}
		if (orphanDupId) {
			await removeInstance(orphanDupId).catch(() => undefined)
		}
		throw error
	}
}

export async function installOwyxServerPack(
	server: OwyxServerEntry,
	apiBase: string,
	appEvents: AppEvents,
	opts?: { allowUpdate?: boolean },
): Promise<{ instanceId: string; job: InstallJobSnapshot | null }> {
	const existing = inflightInstalls.get(server.id)
	if (existing) return existing

	const pending = installOwyxServerPackInner(server, apiBase, appEvents, opts).finally(() => {
		inflightInstalls.delete(server.id)
	})
	inflightInstalls.set(server.id, pending)
	return pending
}
