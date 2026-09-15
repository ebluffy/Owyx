/**
 * Owyx control-plane catalog client.
 * Base: https://api.owyx.site (override via settings).
 * Header: X-Owyx-Client-Key (placeholder only in git — never commit real secrets).
 */

export const DEFAULT_OWYX_API_BASE = 'https://api.owyx.site'
export const LOCAL_OWYX_API_FALLBACK = 'http://127.0.0.1:3001'

const STORAGE_API = 'owyx.apiBaseUrl'
const STORAGE_KEY = 'owyx.clientKey'
const STORAGE_DEMO = 'owyx.demoServers'
const STORAGE_LOCAL_FALLBACK = 'owyx.allowLocalApiFallback'

export type OwyxServerEntry = {
	id: string
	name: string
	description: string
	mcVersion?: string
	address: string
	iconUrl?: string
	packUrl?: string
	demo?: boolean
}

export type OwyxCatalogResult = {
	servers: OwyxServerEntry[]
	fromFallback: boolean
}

/** Hardcoded OBT smoke seed — only when demo flag is on and API is down. */
const DEMO_SERVER: OwyxServerEntry = {
	id: 'demo-obt',
	name: 'Owyx OBT (demo)',
	description: 'Offline-mode smoke server for launcher testing. Not Modrinth Hosting.',
	mcVersion: '1.20.1',
	address: '45.131.186.146:1488',
	demo: true,
}

/** Only http(s) API bases — never file:/javascript:/etc. */
export function sanitizeOwyxApiBase(url: string | null | undefined): string {
	const raw = (url ?? '').trim()
	if (!raw) return DEFAULT_OWYX_API_BASE
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			return DEFAULT_OWYX_API_BASE
		}
		return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''))
	} catch {
		return DEFAULT_OWYX_API_BASE
	}
}

/** Safe https (or relative) URLs for pack download / icons. */
export function isSafeExternalHttpsUrl(url: string | null | undefined): boolean {
	if (!url) return false
	const trimmed = url.trim()
	if (trimmed.startsWith('/')) return true
	try {
		const parsed = new URL(trimmed)
		return parsed.protocol === 'https:'
	} catch {
		return false
	}
}

export function getStoredOwyxApiBase(): string {
	try {
		return sanitizeOwyxApiBase(localStorage.getItem(STORAGE_API))
	} catch {
		return DEFAULT_OWYX_API_BASE
	}
}

export function setStoredOwyxApiBase(url: string) {
	localStorage.setItem(STORAGE_API, sanitizeOwyxApiBase(url))
}

export function getOwyxClientKey(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_OWYX_CLIENT_KEY || ''
	} catch {
		return import.meta.env.VITE_OWYX_CLIENT_KEY || ''
	}
}

export function setOwyxClientKey(key: string) {
	localStorage.setItem(STORAGE_KEY, key)
}

export function getOwyxDemoFlag(): boolean {
	try {
		const v = localStorage.getItem(STORAGE_DEMO)
		if (v === null) return true
		return v === '1' || v === 'true'
	} catch {
		return true
	}
}

export function setOwyxDemoFlag(on: boolean) {
	localStorage.setItem(STORAGE_DEMO, on ? '1' : '0')
}

/** Localhost :3001 fallback is opt-in (dev only) — never default in release. */
export function getOwyxLocalApiFallback(): boolean {
	try {
		return localStorage.getItem(STORAGE_LOCAL_FALLBACK) === '1'
	} catch {
		return false
	}
}

export function setOwyxLocalApiFallback(on: boolean) {
	localStorage.setItem(STORAGE_LOCAL_FALLBACK, on ? '1' : '0')
}

function sanitizeMediaUrl(url: string | undefined): string | undefined {
	if (!url) return undefined
	return isSafeExternalHttpsUrl(url) ? url.trim() : undefined
}

function normalizeEntry(raw: Record<string, unknown>, index: number): OwyxServerEntry | null {
	const name = String(raw.name ?? raw.title ?? '').trim()
	const address = String(
		raw.address ?? raw.playAddress ?? raw.play_address ?? raw.host ?? '',
	).trim()
	if (!name || !address) return null
	const packRaw = raw.packUrl
		? String(raw.packUrl)
		: raw.pack_url
			? String(raw.pack_url)
			: raw.pack
				? String(raw.pack)
				: undefined
	const iconRaw = raw.iconUrl
		? String(raw.iconUrl)
		: raw.icon_url
			? String(raw.icon_url)
			: raw.icon
				? String(raw.icon)
				: undefined
	return {
		id: String(raw.id ?? raw.slug ?? `server-${index}`),
		name,
		description: String(raw.description ?? raw.desc ?? ''),
		mcVersion: raw.mcVersion
			? String(raw.mcVersion)
			: raw.mc_version
				? String(raw.mc_version)
				: raw.version
					? String(raw.version)
					: undefined,
		address,
		iconUrl: sanitizeMediaUrl(iconRaw),
		packUrl: sanitizeMediaUrl(packRaw),
	}
}

function parseCatalog(data: unknown): OwyxServerEntry[] {
	if (!data || typeof data !== 'object') return []
	const root = data as Record<string, unknown>
	const list = Array.isArray(root)
		? root
		: Array.isArray(root.servers)
			? root.servers
			: Array.isArray(root.packs)
				? root.packs
				: Array.isArray(root.data)
					? root.data
					: []

	const out: OwyxServerEntry[] = []
	list.forEach((item, i) => {
		if (item && typeof item === 'object') {
			const entry = normalizeEntry(item as Record<string, unknown>, i)
			if (entry) out.push(entry)
		}
	})

	if (out.length === 0 && Array.isArray(root.packs)) {
		root.packs.forEach((pack, i) => {
			if (!pack || typeof pack !== 'object') return
			const p = pack as Record<string, unknown>
			const nested = Array.isArray(p.servers) ? p.servers : [p]
			nested.forEach((item, j) => {
				if (item && typeof item === 'object') {
					const entry = normalizeEntry(item as Record<string, unknown>, i * 100 + j)
					if (entry) {
						if (!entry.packUrl && p.url) {
							entry.packUrl = sanitizeMediaUrl(String(p.url))
						}
						out.push(entry)
					}
				}
			})
		})
	}

	return out
}

export async function fetchOwyxCatalog(opts: {
	baseUrl: string
	clientKey?: string
	demoFallback?: boolean
	/** Explicit opt-in for http://127.0.0.1:3001 after primary base fails */
	allowLocalFallback?: boolean
}): Promise<OwyxCatalogResult> {
	const primary = sanitizeOwyxApiBase(opts.baseUrl)
	const bases = [primary]
	if (opts.allowLocalFallback && primary !== LOCAL_OWYX_API_FALLBACK) {
		bases.push(LOCAL_OWYX_API_FALLBACK)
	}

	for (const base of bases) {
		try {
			const url = `${base.replace(/\/$/, '')}/v1/launcher/catalog`
			const headers: Record<string, string> = {
				Accept: 'application/json',
			}
			// Attach client key only for the configured primary base (not localhost fallback)
			if (opts.clientKey && base === primary) {
				headers['X-Owyx-Client-Key'] = opts.clientKey
			}
			const res = await fetch(url, {
				method: 'GET',
				headers,
				signal: AbortSignal.timeout(8000),
			})
			if (!res.ok) {
				const alt = await fetch(`${base.replace(/\/$/, '')}/api/launcher/servers`, {
					method: 'GET',
					headers,
					signal: AbortSignal.timeout(8000),
				})
				if (!alt.ok) continue
				const altData = await alt.json()
				return { servers: parseCatalog(altData), fromFallback: false }
			}
			const data = await res.json()
			return { servers: parseCatalog(data), fromFallback: false }
		} catch {
			// try next base
		}
	}

	if (opts.demoFallback !== false) {
		return { servers: [DEMO_SERVER], fromFallback: true }
	}
	return { servers: [], fromFallback: true }
}
