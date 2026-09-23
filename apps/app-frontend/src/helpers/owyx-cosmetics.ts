/**
 * Persist Owyx cosmetics (skin) to disk per LAUNCHER_SITE_CONTRACT.
 * Path: %USERPROFILE%/owyx/skins/{nickname}.png (Windows) / ~/owyx/skins/…
 */

import { homeDir, join } from '@tauri-apps/api/path'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	DEFAULT_OWYX_API_BASE,
	getStoredOwyxApiBase,
	isAllowedOwyxAssetUrl,
	sanitizeOwyxApiBase,
} from '@/helpers/owyx-api'
import { assertOwyxCosmeticsArgs } from '@/helpers/owyx-cosmetics-args'

function sanitizeNick(nick: string): string {
	return nick.replace(/[^A-Za-z0-9_\-.]/g, '_').slice(0, 32) || 'player'
}

function resolveSkinDownloadUrl(skinUrl: string): string | null {
	const trimmed = skinUrl.trim()
	if (!isAllowedOwyxAssetUrl(trimmed)) return null
	if (trimmed.startsWith('/')) {
		const base = sanitizeOwyxApiBase(getStoredOwyxApiBase() || DEFAULT_OWYX_API_BASE)
		return `${base.replace(/\/$/, '')}${trimmed}`
	}
	return trimmed
}

async function downloadCosmeticPng(url: string | null): Promise<Uint8Array | null> {
	if (!url) return null
	const absolute = resolveSkinDownloadUrl(url)
	if (!absolute) return null
	let res: Response
	try {
		res = await tauriFetch(absolute, { method: 'GET', signal: AbortSignal.timeout(15000) })
	} catch {
		res = await fetch(absolute, { method: 'GET', signal: AbortSignal.timeout(15000) })
	}
	if (!res.ok) return null
	const buf = new Uint8Array(await res.arrayBuffer())
	if (buf.byteLength < 64) return null
	return buf
}

export async function syncOwyxCosmeticsToDisk(
	nickname: string,
	cosmetics: Record<string, unknown> | null | undefined,
): Promise<void> {
	// Guard against swapped args (cosmetics, nickname) that silently no-op'd (#129 review).
	assertOwyxCosmeticsArgs(nickname, cosmetics)
	if (!cosmetics || !nickname) return
	const skinUrl = cosmetics.skinUrl
		? String(cosmetics.skinUrl)
		: cosmetics.skin_url
			? String(cosmetics.skin_url)
			: null
	const capeUrl = cosmetics.capeUrl
		? String(cosmetics.capeUrl)
		: cosmetics.cape_url
			? String(cosmetics.cape_url)
			: null

	const home = await homeDir()
	const nick = sanitizeNick(nickname)

	const skinBuf = await downloadCosmeticPng(skinUrl)
	if (skinBuf) {
		const dir = await join(home, 'owyx', 'skins')
		await mkdir(dir, { recursive: true })
		await writeFile(await join(dir, `${nick}.png`), skinBuf)
	}

	const capeBuf = await downloadCosmeticPng(capeUrl)
	if (capeBuf) {
		const dir = await join(home, 'owyx', 'capes')
		await mkdir(dir, { recursive: true })
		await writeFile(await join(dir, `${nick}.png`), capeBuf)
	}
}
