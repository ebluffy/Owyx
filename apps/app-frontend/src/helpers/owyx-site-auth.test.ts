import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
	__resetOwyxSiteAuthForTests,
	cancelOwyxSiteBrowserLogin,
	getStoredOwyxSiteSession,
	installOwyxSiteAuthDeps,
	loginOwyxSite,
	loginOwyxSiteViaBrowser,
	type OwyxBrowserLoginReady,
	OwyxSiteAuthError,
	reopenOwyxSiteBrowserLoginUrl,
	siteAuthDeps,
} from './owyx-site-auth.ts'

type ListenHandler<T = unknown> = (event: { payload: T }) => void

describe('OwyxSiteAuthError', () => {
	it('creates error instances with stable codes and messages', () => {
		const err = new OwyxSiteAuthError('invalid_credentials', 'Bad login')
		assert.ok(err instanceof Error)
		assert.ok(err instanceof OwyxSiteAuthError)
		assert.equal(err.name, 'OwyxSiteAuthError')
		assert.equal(err.code, 'invalid_credentials')
		assert.equal(err.message, 'Bad login')
	})
})

describe('loginOwyxSite (password fallback)', () => {
	const origDeps = { ...siteAuthDeps }
	let clientKey = 'test-client-key'
	let fetchCalls: Array<{ url: string; init?: RequestInit }> = []

	beforeEach(() => {
		__resetOwyxSiteAuthForTests()
		clientKey = 'test-client-key'
		fetchCalls = []
		installOwyxSiteAuthDeps({
			getClientKey: () => clientKey,
			invoke: async () => undefined,
			fetch: async (url, init) => {
				fetchCalls.push({ url, init })
				return new Response(
					JSON.stringify({
						token: 'jwt-token-123',
						user: { id: 42, nickname: 'Steve', displayNickname: 'StevePlay' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				)
			},
		})
	})

	afterEach(() => {
		__resetOwyxSiteAuthForTests()
		installOwyxSiteAuthDeps(origDeps)
	})

	it('throws missing_client_key when client key is empty', async () => {
		clientKey = ''
		await assert.rejects(
			async () => loginOwyxSite('user@example.com', 'secret'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'missing_client_key')
				return true
			},
		)
	})

	it('throws invalid_credentials when login or password is empty', async () => {
		await assert.rejects(
			async () => loginOwyxSite('   ', 'secret'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'invalid_credentials')
				return true
			},
		)

		await assert.rejects(
			async () => loginOwyxSite('user@example.com', ''),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'invalid_credentials')
				return true
			},
		)
	})

	it('sends POST /api/auth/launcher/login with header and remember:true on success', async () => {
		const session = await loginOwyxSite('testuser', 'secret123')
		assert.equal(session.token, 'jwt-token-123')
		assert.equal(session.user.nickname, 'Steve')
		assert.equal(session.user.displayNickname, 'StevePlay')
		assert.equal(getStoredOwyxSiteSession()?.token, 'jwt-token-123')

		assert.equal(fetchCalls.length, 1)
		const call = fetchCalls[0]
		assert.ok(call.url.endsWith('/api/auth/launcher/login'))
		assert.equal(call.init?.method, 'POST')
		const headers = call.init?.headers as Record<string, string>
		assert.equal(headers['X-Owyx-Client-Key'], 'test-client-key')
		const body = JSON.parse(String(call.init?.body))
		assert.deepEqual(body, {
			login: 'testuser',
			password: 'secret123',
			remember: true,
		})
	})

	it('maps 401 unauthorized_client', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () =>
				new Response(JSON.stringify({ error: 'unauthorized_client' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'unauthorized_client')
				return true
			},
		)
	})

	it('maps 401 incorrect login or password', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () =>
				new Response(JSON.stringify({ error: 'Неверный логин или пароль' }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'wrongpass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'invalid_credentials')
				return true
			},
		)
	})

	it('maps 403 access denied', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () =>
				new Response(JSON.stringify({ error: 'Аккаунт заблокирован' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				}),
		})

		await assert.rejects(
			async () => loginOwyxSite('banneduser', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'access_denied')
				return true
			},
		)
	})

	it('maps 429 rate limited', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () =>
				new Response(JSON.stringify({ error: 'Too many attempts', retryAfterSec: 900 }), {
					status: 429,
					headers: { 'Content-Type': 'application/json' },
				}),
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'rate_limited')
				return true
			},
		)
	})

	it('maps 503 missing server client key', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () =>
				new Response(JSON.stringify({ error: 'launcher_client_key_missing' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json' },
				}),
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'missing_client_key')
				return true
			},
		)
	})

	it('maps timeout on AbortError or TimeoutError', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () => {
				const err = new Error('Request timed out')
				err.name = 'TimeoutError'
				throw err
			},
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'timeout')
				return true
			},
		)
	})

	it('maps network errors', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () => {
				throw new TypeError('Failed to fetch')
			},
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'network')
				return true
			},
		)
	})

	it('does not write session when flow is canceled in-flight', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () => {
				// Simulate user canceling while network request is in-flight
				cancelOwyxSiteBrowserLogin()
				return new Response(
					JSON.stringify({
						token: 'stale-token',
						user: { id: 1, nickname: 'Stale' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				)
			},
		})

		await assert.rejects(
			async () => loginOwyxSite('user', 'pass'),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'canceled')
				assert.equal(err.message, 'Login canceled')
				return true
			},
		)

		assert.equal(getStoredOwyxSiteSession(), null)
	})
})

describe('loginOwyxSiteViaBrowser (SSO & cancellation)', () => {
	const origDeps = { ...siteAuthDeps }
	let clientKey = 'test-client-key'
	let activeEventListeners: Map<string, ListenHandler[]> = new Map()

	beforeEach(() => {
		__resetOwyxSiteAuthForTests()
		clientKey = 'test-client-key'
		activeEventListeners = new Map()
		installOwyxSiteAuthDeps({
			getClientKey: () => clientKey,
			listen: async (event: string, handler: ListenHandler) => {
				const list = activeEventListeners.get(event) || []
				list.push(handler)
				activeEventListeners.set(event, list)
				return () => {
					const cur = activeEventListeners.get(event) || []
					activeEventListeners.set(
						event,
						cur.filter((h) => h !== handler),
					)
				}
			},
			invoke: async (cmd: string, args: { state?: string }) => {
				if (cmd === 'plugin:utils|owyx_site_browser_login') {
					// Simulate event emission from Rust
					const listeners = activeEventListeners.get('owyx-site-browser-login-ready') || []
					for (const l of listeners) {
						l({
							payload: {
								url: `https://owyx.site/launcher-auth?port=45678&state=${args.state}`,
								opened: true,
							},
						})
					}
					return 'auth-code-xyz'
				}
				return undefined
			},
			fetch: async (url: string) => {
				if (url.includes('/api/auth/launcher/exchange')) {
					return new Response(
						JSON.stringify({
							token: 'browser-jwt-token',
							user: { id: 99, nickname: 'Alex', displayNickname: 'AlexGamer' },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					)
				}
				if (url.includes('/api/launcher/me')) {
					return new Response(
						JSON.stringify({
							token: 'browser-jwt-token',
							user: { id: 99, nickname: 'Alex', displayNickname: 'AlexGamer' },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					)
				}
				return new Response('Not found', { status: 404 })
			},
		})
	})

	afterEach(() => {
		__resetOwyxSiteAuthForTests()
		installOwyxSiteAuthDeps(origDeps)
	})

	it('completes browser login, emits onReady details, and persists session', async () => {
		let readyPayload: OwyxBrowserLoginReady | null = null
		const session = await loginOwyxSiteViaBrowser(undefined, (details) => {
			readyPayload = details
		})

		assert.ok(readyPayload)
		assert.equal(readyPayload.opened, true)
		assert.ok(readyPayload.url.includes('launcher-auth'))
		assert.equal(session.token, 'browser-jwt-token')
		assert.equal(session.user.nickname, 'Alex')
		assert.equal(getStoredOwyxSiteSession()?.token, 'browser-jwt-token')
	})

	it('handles cancellation pending event registration race', async () => {
		let unlistenCalled = false
		installOwyxSiteAuthDeps({
			listen: async () => {
				// Cancel happens WHILE listen is awaiting
				cancelOwyxSiteBrowserLogin()
				return () => {
					unlistenCalled = true
				}
			},
			invoke: async () => {
				assert.fail('invoke must not be called after cancellation during listen registration')
			},
		})

		await assert.rejects(
			async () => loginOwyxSiteViaBrowser(),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.message, 'Login canceled')
				return true
			},
		)

		assert.equal(unlistenCalled, true)
		assert.equal(getStoredOwyxSiteSession(), null)
	})

	it('handles cancellation during Rust browser login command', async () => {
		installOwyxSiteAuthDeps({
			invoke: async (cmd) => {
				if (cmd === 'plugin:utils|owyx_site_browser_login') {
					cancelOwyxSiteBrowserLogin()
					throw new Error('Login canceled')
				}
				return undefined
			},
		})

		await assert.rejects(
			async () => loginOwyxSiteViaBrowser(),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.message, 'Login canceled')
				return true
			},
		)

		assert.equal(getStoredOwyxSiteSession(), null)
	})

	it('handles command timeout from Rust agent', async () => {
		installOwyxSiteAuthDeps({
			invoke: async (cmd) => {
				if (cmd === 'plugin:utils|owyx_site_browser_login') {
					throw new Error('Command timed out after 5m')
				}
				return undefined
			},
		})

		await assert.rejects(
			async () => loginOwyxSiteViaBrowser(),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.code, 'timeout')
				return true
			},
		)
	})

	it('does not write session when canceled during token exchange', async () => {
		installOwyxSiteAuthDeps({
			fetch: async () => {
				cancelOwyxSiteBrowserLogin()
				return new Response(
					JSON.stringify({
						token: 'canceled-jwt',
						user: { id: 1, nickname: 'CanceledUser' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				)
			},
		})

		await assert.rejects(
			async () => loginOwyxSiteViaBrowser(),
			(err: unknown) => {
				assert.ok(err instanceof OwyxSiteAuthError)
				assert.equal(err.message, 'Login canceled')
				return true
			},
		)

		assert.equal(getStoredOwyxSiteSession(), null)
	})
})

describe('reopenOwyxSiteBrowserLoginUrl', () => {
	const origDeps = { ...siteAuthDeps }
	let invokeCalls: Array<{ cmd: string; args?: Record<string, unknown> }> = []

	beforeEach(() => {
		__resetOwyxSiteAuthForTests()
		invokeCalls = []
		installOwyxSiteAuthDeps({
			invoke: (async (cmd: string, args?: Record<string, unknown>) => {
				invokeCalls.push({ cmd, args })
				return true
			}) as typeof siteAuthDeps.invoke,
		})
	})

	afterEach(() => {
		installOwyxSiteAuthDeps(origDeps)
	})

	it('rejects URLs that are not owyx.site launcher-auth links', async () => {
		assert.equal(
			await reopenOwyxSiteBrowserLoginUrl('https://evil.example/launcher-auth?x=1'),
			false,
		)
		assert.equal(await reopenOwyxSiteBrowserLoginUrl('http://owyx.site/launcher-auth?x=1'), false)
		assert.equal(await reopenOwyxSiteBrowserLoginUrl('https://owyx.site/somewhere-else'), false)
		assert.equal(invokeCalls.length, 0)
	})

	it('calls the Rust reopen command for a valid launcher-auth URL', async () => {
		const url = 'https://owyx.site/launcher-auth?port=1234&state=abcdef'
		assert.equal(await reopenOwyxSiteBrowserLoginUrl(url), true)
		assert.deepEqual(invokeCalls, [
			{ cmd: 'plugin:utils|owyx_site_browser_login_open', args: { url } },
		])
	})
})
