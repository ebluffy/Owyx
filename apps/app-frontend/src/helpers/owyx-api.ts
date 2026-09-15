/**
 * Owyx control-plane catalog client.
 * Base: https://api.owyx.site (override via settings / OWYX_API_BASE_URL).
 * Header: X-Owyx-Client-Key (placeholder only in git — never commit real secrets).
 */

export const DEFAULT_OWYX_API_BASE = 'https://api.owyx.site'
export const LOCAL_OWYX_API_FALLBACK = 'http://127.0.0.1:3001'

const STORAGE_API = 'owyx.apiBaseUrl'
const STORAGE_KEY = 'owyx.clientKey'
const STORAGE_DEMO = 'owyx.demoServers'

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

export function getStoredOwyxApiBase(): string {
	try {
		return localStorage.getItem(STORAGE_API) || DEFAULT_OWYX_API_BASE
	} catch {
		return DEFAULT_OWYX_API_BASE
	}
}

export function setStoredOwyxApiBase(url: string) {
	localStorage.setItem(STORAGE_API, url)
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

function normalizeEntry(raw: Record<string, unknown>, index: number): OwyxServerEntry | null {
	const name = String(raw.name ?? raw.title ?? '').trim()
	const address = String(
		raw.address ?? raw.playAddress ?? raw.play_address ?? raw.host ?? '',
	).trim()
	if (!name || !address) return null
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
		iconUrl: raw.iconUrl
			? String(raw.iconUrl)
			: raw.icon_url
				? String(raw.icon_url)
				: raw.icon
					? String(raw.icon)
					: undefined,
		packUrl: raw.packUrl
			? String(raw.packUrl)
			: raw.pack_url
				? String(raw.pack_url)
				: raw.pack
					? String(raw.pack)
					: undefined,
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

	// Some contracts nest servers under packs
	if (out.length === 0 && Array.isArray(root.packs)) {
		root.packs.forEach((pack, i) => {
			if (!pack || typeof pack !== 'object') return
			const p = pack as Record<string, unknown>
			const nested = Array.isArray(p.servers) ? p.servers : [p]
			nested.forEach((item, j) => {
				if (item && typeof item === 'object') {
					const entry = normalizeEntry(item as Record<string, unknown>, i * 100 + j)
					if (entry) {
						if (!entry.packUrl && p.url) entry.packUrl = String(p.url)
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
}): Promise<OwyxCatalogResult> {
	const bases = [opts.baseUrl, LOCAL_OWYX_API_FALLBACK].filter(
		(b, i, arr) => b && arr.indexOf(b) === i,
	)

	for (const base of bases) {
		try {
			const url = `${base.replace(/\/$/, '')}/v1/launcher/catalog`
			const headers: Record<string, string> = {
				Accept: 'application/json',
			}
			if (opts.clientKey) {
				headers['X-Owyx-Client-Key'] = opts.clientKey
			}
			const res = await fetch(url, {
				method: 'GET',
				headers,
				signal: AbortSignal.timeout(8000),
			})
			if (!res.ok) {
				// Try alternate path used by older site contract
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
