import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
	__resetOwyxPackSocketForTests,
	packSocketDeps,
	subscribeOwyxPackUpdated,
	teardownOwyxPackSocket,
} from './owyx-pack-socket.ts'

type FakeSocket = {
	connected: boolean
	handlers: Map<string, Function[]>
	on: (event: string, fn: Function) => FakeSocket
	removeAllListeners: () => void
	disconnect: () => void
}

function makeFakeSocket(): FakeSocket {
	const handlers = new Map<string, Function[]>()
	return {
		connected: true,
		handlers,
		on(event, fn) {
			const list = handlers.get(event) || []
			list.push(fn)
			handlers.set(event, list)
			return this
		},
		removeAllListeners() {
			handlers.clear()
		},
		disconnect() {
			this.connected = false
		},
	}
}

describe('owyx-pack-socket P3-b3', () => {
	const orig = { ...packSocketDeps }
	let token = ''
	let sessionClearedCbs: Array<() => void> = []
	let sessionChangedCbs: Array<() => void> = []
	let ioCalls: Array<{ origin: string; opts: Record<string, unknown> }> = []
	let sockets: FakeSocket[] = []

	afterEach(() => {
		__resetOwyxPackSocketForTests()
		Object.assign(packSocketDeps, orig)
		token = ''
		sessionClearedCbs = []
		sessionChangedCbs = []
		ioCalls = []
		sockets = []
	})

	function installMocks() {
		packSocketDeps.getToken = () => token
		packSocketDeps.getOrigin = () => 'https://api.owyx.site'
		packSocketDeps.onSessionCleared = (cb) => {
			sessionClearedCbs.push(cb)
			return () => {
				sessionClearedCbs = sessionClearedCbs.filter((x) => x !== cb)
			}
		}
		packSocketDeps.onSessionChanged = (cb) => {
			sessionChangedCbs.push(cb)
			return () => {
				sessionChangedCbs = sessionChangedCbs.filter((x) => x !== cb)
			}
		}
		packSocketDeps.io = ((origin: string, opts: Record<string, unknown>) => {
			ioCalls.push({ origin, opts })
			const s = makeFakeSocket()
			sockets.push(s)
			return s as unknown as ReturnType<typeof orig.io>
		}) as typeof packSocketDeps.io
	}

	it('keeps session hooks when subscribe runs before login, then connects on persist', () => {
		installMocks()
		token = ''

		const events: string[] = []
		const unsub = subscribeOwyxPackUpdated((e) => events.push(e.packId))

		assert.equal(ioCalls.length, 0, 'no socket without token')
		assert.equal(sessionChangedCbs.length, 1, 'session-changed hook registered')
		assert.equal(sessionClearedCbs.length, 1, 'session-cleared hook registered')

		token = 'jwt-after-login'
		for (const cb of [...sessionChangedCbs]) cb()

		assert.equal(ioCalls.length, 1, 'io() after login')
		assert.equal(sockets.length, 1)
		assert.equal(sockets[0].connected, true)

		const packHandler = sockets[0].handlers.get('pack_updated')?.[0]
		assert.ok(packHandler)
		packHandler({ packId: 'p1', version: '2' })
		assert.deepEqual(events, ['p1'])

		unsub()
		assert.equal(sessionChangedCbs.length, 0, 'hooks unbound when last listener leaves')
		assert.equal(sockets[0].connected, false)
	})

	it('skips force-reconnect when token is unchanged', () => {
		installMocks()
		token = 'same-jwt'
		const unsub = subscribeOwyxPackUpdated(() => {})
		assert.equal(ioCalls.length, 1)

		for (const cb of [...sessionChangedCbs]) cb()
		assert.equal(ioCalls.length, 1, 'no second io() for same token')

		unsub()
	})

	it('reconnects when token changes while subscribed', () => {
		installMocks()
		token = 'jwt-a'
		const unsub = subscribeOwyxPackUpdated(() => {})
		assert.equal(ioCalls.length, 1)
		const first = sockets[0]

		token = 'jwt-b'
		for (const cb of [...sessionChangedCbs]) cb()
		assert.equal(ioCalls.length, 2)
		assert.equal(first.connected, false)
		assert.equal(sockets[1].connected, true)

		unsub()
	})

	it('teardownOwyxPackSocket closes socket and unbinds hooks', () => {
		installMocks()
		token = 'jwt'
		subscribeOwyxPackUpdated(() => {})
		assert.equal(sessionChangedCbs.length, 1)
		teardownOwyxPackSocket()
		assert.equal(sessionChangedCbs.length, 0)
		assert.equal(sockets[0].connected, false)
	})
})
