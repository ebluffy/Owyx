/**
 * Upload a Minecraft skin PNG for the signed-in Owyx site account
 * (PUT /api/profile/skin) and sync to local CSL disk cache.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	DEFAULT_OWYX_API_BASE,
	getOwyxClientKey,
	getStoredOwyxApiBase,
	sanitizeOwyxApiBase,
} from '@/helpers/owyx-api'
import { syncOwyxCosmeticsToDisk } from '@/helpers/owyx-cosmetics'
import { getStoredOwyxSiteSession } from '@/helpers/owyx-site-auth'

async function owyxFetch(input: string, init?: RequestInit): Promise<Response> {
	try {
		return await tauriFetch(input, init as Parameters<typeof tauriFetch>[1])
	} catch {
		return await fetch(input, init)
	}
}

export async function uploadOwyxAccountSkin(opts: {
	pngBytes: Uint8Array
	model?: 'classic' | 'slim'
}): Promise<{ skinUrl: string; skinModel: string }> {
	const session = getStoredOwyxSiteSession()
	if (!session?.token) {
		throw new Error('Sign in to Owyx to upload a skin')
	}
	const base = sanitizeOwyxApiBase(getStoredOwyxApiBase() || DEFAULT_OWYX_API_BASE).replace(
		/\/$/,
		'',
	)
	const fd = new FormData()
	fd.append(
		'skin',
		new Blob(
			[
				opts.pngBytes.buffer.slice(
					opts.pngBytes.byteOffset,
					opts.pngBytes.byteOffset + opts.pngBytes.byteLength,
				) as ArrayBuffer,
			],
			{ type: 'image/png' },
		),
		'skin.png',
	)
	fd.append('model', opts.model === 'slim' ? 'slim' : 'classic')

	const headers: Record<string, string> = {
		Accept: 'application/json',
		Authorization: `Bearer ${session.token}`,
	}
	const key = getOwyxClientKey()
	if (key) headers['X-Owyx-Client-Key'] = key

	const res = await owyxFetch(`${base}/api/profile/skin`, {
		method: 'PUT',
		headers,
		body: fd,
		signal: AbortSignal.timeout(30_000),
	})
	const data = (await res.json().catch(() => ({}))) as {
		skin_url?: string
		skin_model?: string
		error?: string
	}
	if (!res.ok) {
		throw new Error(data.error || `Skin upload failed (${res.status})`)
	}
	const nick = session.user.nickname
	// Signature is (nickname, cosmetics) — see owyx-cosmetics.ts.
	await syncOwyxCosmeticsToDisk(nick, {
		skinUrl: data.skin_url,
		skin_url: data.skin_url,
		skinModel: data.skin_model,
		skin_model: data.skin_model,
	})
	return {
		skinUrl: String(data.skin_url || ''),
		skinModel: String(data.skin_model || opts.model || 'classic'),
	}
}
