/**
 * Owyx site account (control-plane email login).
 * Contract: owyxsite/LAUNCHER_SITE_CONTRACT.md — POST /api/auth/login, GET /api/launcher/me
 *
 * JWT lives in OS app-data (`~/owyx/site_session.json` via Tauri), not webview localStorage.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import {
	DEFAULT_OWYX_API_BASE,
	getOwyxClientKey,
	getStoredOwyxApiBase,
	sanitizeOwyxApiBase,
} from './owyx-api.ts'
import { syncOwyxCosmeticsToDisk } from './owyx-cosmetics.ts'

/** Prefer Tauri HTTP plugin (no CORS); fall back to browser fetch for vitest/SSR. */
async function owyxFetch(input: string, init?: RequestInit): Promise<Response> {
	try {
		return await tauriFetch(input, init as Parameters<typeof tauriFetch>[1])
	} catch {
		return await fetch(input, init)
	}
}

export type OwyxSiteAuthDeps = {
	invoke: typeof invoke
	listen: typeof listen
	fetch: (input: string, init?: RequestInit) => Promise<Response>
	getClientKey: () => string
}

export const siteAuthDeps: OwyxSiteAuthDeps = {
	invoke,
	listen,
	fetch: owyxFetch,
	getClientKey: getOwyxClientKey,
}

export function installOwyxSiteAuthDeps(partial: Partial<OwyxSiteAuthDeps>) {
	Object.assign(siteAuthDeps, partial)
}

/** Legacy keys — migrated once into OS storage then cleared. */
const LEGACY_STORAGE_TOKEN = 'owyx.siteToken'
const LEGACY_STORAGE_USER = 'owyx.siteUser'

/** Bumped on clear so in-flight hydrate /me cannot resurrect a wiped session. */
let sessionEpoch = 0
let memorySession: OwyxSiteSession | null = null
let hydratePromise: Promise<OwyxSiteSession | null> | null = null

/** Bumped on new attempt or cancel to invalidate in-flight browser/password auth flows. */
let authAttemptEpoch = 0
let activeAbortController: AbortController | null = null

export function __resetOwyxSiteAuthForTests() {
	authAttemptEpoch = 0
	if (activeAbortController) {
		activeAbortController.abort()
		activeAbortController = null
	}
	clearOwyxSiteSession()
}

export type OwyxSiteUser = {
	id: number | string
	nickname: string
	/** Visible / in-game name. Falls back to login nickname. */
	displayNickname: string
	email?: string
	role?: string
	serverAccess?: boolean
	accessReason?: string
	avatarUrl?: string | null
}

export type OwyxSiteSession = {
	token: string
	user: OwyxSiteUser
}

function authHeaders(token?: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'Content-Type': 'application/json',
	}
	const key = siteAuthDeps.getClientKey()
	if (key) headers['X-Owyx-Client-Key'] = key
	if (token) headers.Authorization = `Bearer ${token}`
	return headers
}

function apiBase(): string {
	return sanitizeOwyxApiBase(getStoredOwyxApiBase() || DEFAULT_OWYX_API_BASE)
}

function parseSessionPayload(raw: string): OwyxSiteSession | null {
	try {
		const data = JSON.parse(raw) as { token?: string; user?: OwyxSiteUser }
		if (!data?.token || !data?.user?.nickname) return null
		return { token: String(data.token), user: data.user }
	} catch {
		return null
	}
}

function readLegacyLocalStorage(): OwyxSiteSession | null {
	try {
		const token = localStorage.getItem(LEGACY_STORAGE_TOKEN)
		const raw = localStorage.getItem(LEGACY_STORAGE_USER)
		if (!token || !raw) return null
		const user = JSON.parse(raw) as OwyxSiteUser
		if (!user?.nickname) return null
		return { token, user }
	} catch {
		return null
	}
}

function clearLegacyLocalStorage() {
	try {
		localStorage.removeItem(LEGACY_STORAGE_TOKEN)
		localStorage.removeItem(LEGACY_STORAGE_USER)
	} catch {
		/* ignore */
	}
}

async function writeOsSession(session: OwyxSiteSession): Promise<void> {
	try {
		await siteAuthDeps.invoke('plugin:utils|owyx_site_session_set', {
			payload: JSON.stringify({ token: session.token, user: session.user }),
		})
	} catch (err) {
		console.warn('Failed to persist Owyx site session to OS storage', err)
	}
}

async function clearOsSession(): Promise<void> {
	try {
		await siteAuthDeps.invoke('plugin:utils|owyx_site_session_clear')
	} catch {
		/* ignore */
	}
}

/** Sync peek of in-memory session (call {@link hydrateOwyxSiteSession} at startup). */
export function getStoredOwyxSiteSession(): OwyxSiteSession | null {
	return memorySession
}

/** Load JWT from OS app-data; migrate legacy localStorage once. */
export async function hydrateOwyxSiteSession(): Promise<OwyxSiteSession | null> {
	if (!hydratePromise) {
		const epoch = sessionEpoch
		hydratePromise = (async () => {
			try {
				const raw = await siteAuthDeps.invoke<string | null>('plugin:utils|owyx_site_session_get')
				if (raw) {
					const parsed = parseSessionPayload(raw)
					if (parsed) {
						if (epoch !== sessionEpoch) return null
						memorySession = parsed
						clearLegacyLocalStorage()
						return memorySession
					}
				}
			} catch {
				/* Tauri unavailable (tests) — fall through */
			}

			if (epoch !== sessionEpoch) return null

			const legacy = readLegacyLocalStorage()
			if (legacy) {
				if (epoch !== sessionEpoch) return null
				memorySession = legacy
				clearLegacyLocalStorage()
				await writeOsSession(legacy)
				return memorySession
			}

			if (epoch !== sessionEpoch) return null
			memorySession = null
			return null
		})()
	}
	return hydratePromise
}

export function clearOwyxSiteSession() {
	sessionEpoch += 1
	memorySession = null
	hydratePromise = null
	clearLegacyLocalStorage()
	void clearOsSession()
	for (const listener of sessionClearedListeners) {
		try {
			listener()
		} catch {
			/* ignore listener errors */
		}
	}
}

type SessionClearedListener = () => void
const sessionClearedListeners = new Set<SessionClearedListener>()

/** App shell registers so Vue refs / presence stop when storage is cleared (F5). */
export function onOwyxSiteSessionCleared(listener: SessionClearedListener): () => void {
	sessionClearedListeners.add(listener)
	return () => {
		sessionClearedListeners.delete(listener)
	}
}

type SessionChangedListener = (session: OwyxSiteSession) => void
const sessionChangedListeners = new Set<SessionChangedListener>()

/** Fired after a successful login / token refresh (P3-b2 pack socket reconnect). */
export function onOwyxSiteSessionChanged(listener: SessionChangedListener): () => void {
	sessionChangedListeners.add(listener)
	return () => {
		sessionChangedListeners.delete(listener)
	}
}

function persistSession(token: string, user: OwyxSiteUser) {
	memorySession = { token, user }
	hydratePromise = Promise.resolve(memorySession)
	void writeOsSession(memorySession)
	for (const listener of sessionChangedListeners) {
		try {
			listener(memorySession)
		} catch {
			/* ignore listener errors */
		}
	}
}

function mapUser(
	raw: Record<string, unknown>,
	cosmetics?: Record<string, unknown> | null,
): OwyxSiteUser {
	const avatarRaw = raw.avatarUrl
		? String(raw.avatarUrl)
		: raw.avatar_url
			? String(raw.avatar_url)
			: cosmetics?.avatarUrl
				? String(cosmetics.avatarUrl)
				: cosmetics?.avatar_url
					? String(cosmetics.avatar_url)
					: null
	let avatarUrl: string | null = avatarRaw
	if (avatarRaw?.startsWith('/')) {
		const base = sanitizeOwyxApiBase(getStoredOwyxApiBase() || DEFAULT_OWYX_API_BASE)
		avatarUrl = `${base.replace(/\/$/, '')}${avatarRaw}`
	}
	return {
		id: (raw.id as number | string) ?? 0,
		nickname: String(raw.nickname ?? raw.username ?? raw.email ?? 'Owyx'),
		displayNickname: String(
			raw.displayNickname ?? raw.display_nickname ?? raw.nickname ?? raw.username ?? 'Owyx',
		),
		email: raw.email ? String(raw.email) : undefined,
		role: raw.role ? String(raw.role) : undefined,
		serverAccess: raw.serverAccess === undefined ? undefined : Boolean(raw.serverAccess),
		accessReason: raw.accessReason ? String(raw.accessReason) : undefined,
		avatarUrl,
	}
}

/** Stable error codes for UI i18n (F15). Message is English fallback. */
export class OwyxSiteAuthError extends Error {
	code:
		| 'missing_client_key'
		| 'unauthorized_client'
		| 'access_denied'
		| 'invalid_credentials'
		| 'rate_limited'
		| 'canceled'
		| 'network'
		| 'timeout'
		| 'generic'
	constructor(code: OwyxSiteAuthError['code'], message: string) {
		super(message)
		this.name = 'OwyxSiteAuthError'
		this.code = code
	}
}

export async function loginOwyxSite(login: string, password: string): Promise<OwyxSiteSession> {
	if (!siteAuthDeps.getClientKey().trim()) {
		throw new OwyxSiteAuthError('missing_client_key', 'Launcher client key is missing.')
	}
	if (!login.trim() || !password) {
		throw new OwyxSiteAuthError('invalid_credentials', 'Login and password are required.')
	}

	const attemptEpoch = ++authAttemptEpoch
	const controller = new AbortController()
	activeAbortController = controller

	let res: Response
	try {
		res = await siteAuthDeps.fetch(`${apiBase()}/api/auth/launcher/login`, {
			method: 'POST',
			headers: authHeaders(),
			body: JSON.stringify({ login: login.trim(), password, remember: true }),
			signal: controller.signal,
		})
	} catch (err: unknown) {
		if (activeAbortController === controller) activeAbortController = null
		if (attemptEpoch !== authAttemptEpoch) {
			throw new OwyxSiteAuthError('canceled', 'Login canceled')
		}
		const name = (err as { name?: string })?.name
		if (name === 'TimeoutError' || name === 'AbortError') {
			throw new OwyxSiteAuthError('timeout', 'Sign-in timed out. Try again.')
		}
		throw new OwyxSiteAuthError('network', 'Could not reach Owyx. Check your connection.')
	} finally {
		if (activeAbortController === controller) activeAbortController = null
	}

	if (attemptEpoch !== authAttemptEpoch) {
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}

	return completeOwyxLogin(res, attemptEpoch)
}

async function completeOwyxLogin(res: Response, attemptEpoch?: number): Promise<OwyxSiteSession> {
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		if (
			data.error === 'unauthorized_client' ||
			(res.status === 401 && data.error === 'unauthorized_client')
		) {
			throw new OwyxSiteAuthError('unauthorized_client', 'Invalid launcher client key.')
		}
		if (data.error === 'launcher_client_key_missing' || res.status === 503) {
			throw new OwyxSiteAuthError(
				'missing_client_key',
				'Launcher client key is missing on the server.',
			)
		}
		if (res.status === 429) {
			throw new OwyxSiteAuthError('rate_limited', 'Too many attempts. Wait before trying again.')
		}
		if (res.status === 401) {
			throw new OwyxSiteAuthError('invalid_credentials', 'Incorrect login or password.')
		}
		if (res.status === 403) {
			throw new OwyxSiteAuthError('access_denied', 'Account access denied.')
		}
		if (res.status === 408 || res.status === 504) {
			throw new OwyxSiteAuthError('timeout', 'Sign-in timed out. Try again.')
		}
		throw new OwyxSiteAuthError('generic', 'Sign-in failed. Try again later.')
	}
	if (
		typeof data.token !== 'string' ||
		!data.token ||
		!data.user ||
		typeof data.user !== 'object' ||
		Array.isArray(data.user)
	) {
		throw new OwyxSiteAuthError('generic', 'Invalid sign-in response.')
	}
	if (attemptEpoch !== undefined && attemptEpoch !== authAttemptEpoch) {
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}
	const user = mapUser(data.user as Record<string, unknown>)
	persistSession(data.token, user)
	return { token: data.token, user }
}

export interface OwyxBrowserLoginReady {
	url: string
	opened: boolean
}

function randomOwyxAuthState(): string {
	const bytes = new Uint8Array(24)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Browser SSO: open owyx.site, wait for loopback code, exchange for JWT. */
export async function loginOwyxSiteViaBrowser(
	siteBase = OWYX_SITE_LOGIN_URL.replace(/\/login\/?$/, ''),
	onReady?: (details: OwyxBrowserLoginReady) => void,
): Promise<OwyxSiteSession> {
	const key = siteAuthDeps.getClientKey()
	if (!key.trim()) {
		throw new OwyxSiteAuthError(
			'missing_client_key',
			'Launcher is missing X-Owyx-Client-Key. Reinstall from a current GitHub release or enable Developer mode to set the key.',
		)
	}

	const attemptEpoch = ++authAttemptEpoch
	const controller = new AbortController()
	activeAbortController = controller
	const state = randomOwyxAuthState()

	let unlisten: (() => void) | undefined
	try {
		unlisten = await siteAuthDeps.listen<OwyxBrowserLoginReady>(
			'owyx-site-browser-login-ready',
			(event) => {
				if (attemptEpoch !== authAttemptEpoch) return
				try {
					const url = new URL(event.payload.url)
					if (url.searchParams.get('state') === state) onReady?.(event.payload)
				} catch {
					// Ignore malformed events from another login attempt.
				}
			},
		)
	} catch {
		// Listen unavailable in non-Tauri test harness
	}

	// CRITICAL: Handle cancellation pending event registration race
	if (attemptEpoch !== authAttemptEpoch) {
		unlisten?.()
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}

	let code: string
	try {
		code = await siteAuthDeps.invoke<string>('plugin:utils|owyx_site_browser_login', {
			siteBase: siteBase.replace(/\/$/, ''),
			state,
		})
	} catch (err: unknown) {
		if (attemptEpoch !== authAttemptEpoch) {
			throw new OwyxSiteAuthError('canceled', 'Login canceled')
		}
		const msg = err instanceof Error ? err.message : String(err)
		if (/cancel/i.test(msg)) {
			throw new OwyxSiteAuthError('canceled', 'Login canceled')
		}
		if (/time.*out/i.test(msg)) {
			throw new OwyxSiteAuthError('timeout', 'Browser sign-in timed out.')
		}
		throw new OwyxSiteAuthError('generic', msg || 'Browser sign-in failed.')
	} finally {
		unlisten?.()
	}

	if (attemptEpoch !== authAttemptEpoch) {
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}

	const base = apiBase()
	let res: Response
	try {
		res = await siteAuthDeps.fetch(`${base.replace(/\/$/, '')}/api/auth/launcher/exchange`, {
			method: 'POST',
			headers: authHeaders(),
			body: JSON.stringify({ code, state }),
			signal: controller.signal,
		})
	} catch (err: unknown) {
		if (activeAbortController === controller) activeAbortController = null
		if (attemptEpoch !== authAttemptEpoch) {
			throw new OwyxSiteAuthError('canceled', 'Login canceled')
		}
		const name = (err as { name?: string })?.name
		if (name === 'TimeoutError' || name === 'AbortError') {
			throw new OwyxSiteAuthError('timeout', 'Connection timed out. Try again.')
		}
		throw new OwyxSiteAuthError('network', 'Could not reach Owyx. Check your connection.')
	} finally {
		if (activeAbortController === controller) activeAbortController = null
	}

	if (attemptEpoch !== authAttemptEpoch) {
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}

	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok || !data.token) {
		if (data.error === 'unauthorized_client' || res.status === 401) {
			throw new OwyxSiteAuthError('unauthorized_client', 'Invalid launcher client key.')
		}
		if (res.status === 429) {
			throw new OwyxSiteAuthError('rate_limited', 'Too many attempts. Wait before trying again.')
		}
		if (res.status === 408 || res.status === 504) {
			throw new OwyxSiteAuthError('timeout', 'Browser sign-in timed out.')
		}
		const err = String(data.error ?? data.message ?? `Browser login failed (${res.status})`)
		throw new OwyxSiteAuthError('generic', err)
	}

	const userRaw = (data.user && typeof data.user === 'object' ? data.user : {}) as Record<
		string,
		unknown
	>
	const user = mapUser(userRaw)
	const token = String(data.token)

	// Session writes MUST NOT happen on canceled flows
	if (attemptEpoch !== authAttemptEpoch) {
		throw new OwyxSiteAuthError('canceled', 'Login canceled')
	}

	persistSession(token, user)
	const refreshed = await fetchOwyxSiteMe(token)
	if (attemptEpoch !== authAttemptEpoch) {
		return { token, user }
	}
	return refreshed ?? { token, user }
}

export function cancelOwyxSiteBrowserLogin() {
	authAttemptEpoch += 1
	if (activeAbortController) {
		activeAbortController.abort()
		activeAbortController = null
	}
	void siteAuthDeps.invoke('plugin:utils|owyx_site_browser_login_cancel').catch(() => undefined)
}

/**
 * Re-open the launcher-auth URL in the system browser ("Open again").
 *
 * Runs through the Rust helper so the AppImage environment scrub applies.
 * Calling the Tauri opener directly here would repeat issue #169.
 */
export async function reopenOwyxSiteBrowserLoginUrl(url: string): Promise<boolean> {
	const trimmed = url.trim()
	if (!/^https:\/\/(?:www\.)?owyx\.site\/launcher-auth\?/i.test(trimmed)) {
		return false
	}
	return siteAuthDeps.invoke<boolean>('plugin:utils|owyx_site_browser_login_open', { url: trimmed })
}

export async function fetchOwyxSiteMe(token?: string): Promise<OwyxSiteSession | null> {
	const session = token
		? { token, user: getStoredOwyxSiteSession()?.user ?? { id: 0, nickname: 'Owyx' } }
		: getStoredOwyxSiteSession()
	if (!session?.token) return null

	const epoch = sessionEpoch
	const tokenAtStart = session.token
	const base = apiBase()
	try {
		const res = await siteAuthDeps.fetch(`${base.replace(/\/$/, '')}/api/launcher/me`, {
			method: 'GET',
			headers: authHeaders(session.token),
			signal: AbortSignal.timeout(10000),
		})
		if (res.status === 401) {
			clearOwyxSiteSession()
			return null
		}
		if (res.status === 403) {
			// Banned/inactive should not look like a silent logout (F4).
			const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>
			const code = String(errBody.code ?? '')
			const err = String(errBody.error ?? '')
			const banned = code === 'banned' || /заблокир|banned|blocked/i.test(err)
			const inactive = code === 'inactive' || /неактивен|inactive/i.test(err)
			if (banned || inactive) {
				const user = mapUser({
					...(session.user as unknown as Record<string, unknown>),
					serverAccess: false,
					accessReason: banned ? 'banned' : 'inactive',
				})
				if (epoch !== sessionEpoch || getStoredOwyxSiteSession()?.token !== tokenAtStart) {
					return null
				}
				persistSession(session.token, user)
				return { token: session.token, user }
			}
			clearOwyxSiteSession()
			return null
		}
		if (!res.ok) return session
		if (epoch !== sessionEpoch || getStoredOwyxSiteSession()?.token !== tokenAtStart) {
			return null
		}
		const data = (await res.json()) as Record<string, unknown>
		const userRaw = (data.user && typeof data.user === 'object' ? data.user : data) as Record<
			string,
			unknown
		>
		// Root serverAccess / accessReason (launcher contract) — not nested under user.
		if (data.serverAccess !== undefined) userRaw.serverAccess = data.serverAccess
		if (data.accessReason !== undefined) userRaw.accessReason = data.accessReason
		const cosmetics =
			data.cosmetics && typeof data.cosmetics === 'object'
				? (data.cosmetics as Record<string, unknown>)
				: null
		if (!userRaw.avatarUrl && data.avatarUrl) userRaw.avatarUrl = data.avatarUrl
		const user = mapUser(userRaw, cosmetics)
		if (epoch !== sessionEpoch || getStoredOwyxSiteSession()?.token !== tokenAtStart) {
			return null
		}
		persistSession(session.token, user)
		const playNick = user.nickname
		void syncOwyxCosmeticsToDisk(playNick, cosmetics).catch(() => undefined)
		return { token: session.token, user }
	} catch {
		return session
	}
}

/** Change visible UI display nickname on the site API, then refresh session. */
export async function updateOwyxDisplayNickname(displayNickname: string): Promise<OwyxSiteSession> {
	const session = getStoredOwyxSiteSession()
	if (!session?.token) throw new Error('Not signed in to Owyx')
	const nick = displayNickname.trim()
	if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
		throw new Error('Display nickname must be 3–16 letters, numbers, or underscores')
	}
	const base = apiBase()
	const res = await siteAuthDeps.fetch(`${base.replace(/\/$/, '')}/api/profile/display-nickname`, {
		method: 'PUT',
		headers: authHeaders(session.token),
		body: JSON.stringify({ displayNickname: nick }),
		signal: AbortSignal.timeout(10000),
	})
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		throw new Error(
			String(data.error ?? data.message ?? `Could not change nickname (${res.status})`),
		)
	}
	const fresh = await fetchOwyxSiteMe(session.token)
	if (!fresh) throw new Error('Could not refresh Owyx session')
	return fresh
}

export async function logoutOwyxSite() {
	const session = getStoredOwyxSiteSession()
	if (session?.token) {
		try {
			const base = apiBase()
			await siteAuthDeps
				.fetch(`${base.replace(/\/$/, '')}/api/auth/logout`, {
					method: 'POST',
					headers: authHeaders(session.token),
					signal: AbortSignal.timeout(5000),
				})
				.catch(() => undefined)
		} catch {
			/* ignore */
		}
	}
	clearOwyxSiteSession()
}

export const OWYX_SITE_REGISTER_URL = 'https://owyx.site/register'
export const OWYX_SITE_LOGIN_URL = 'https://owyx.site/login'
export const OWYX_SITE_PROFILE_URL = 'https://owyx.site/profile'
export const OWYX_SITE_SUPPORT_URL = 'https://owyx.site'
export const OWYX_SITE_CHANGELOG_URL = 'https://github.com/ebluffy/Owyx/releases'
