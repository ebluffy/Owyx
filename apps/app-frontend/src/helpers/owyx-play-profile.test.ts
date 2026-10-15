import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createOwyxPlayProfileSeeder } from './owyx-play-profile.ts'

type Account = { profile: { name: string }; is_offline: boolean }
const microsoft: Account = { profile: { name: 'Steve' }, is_offline: false }
const offline: Account = { profile: { name: 'Steve' }, is_offline: true }

function harness(initial: Account[] = []) {
	const accounts = [...initial]
	const calls: Array<{ nickname: string; makeActive: boolean }> = []
	let active = initial[0]
	let changes = 0
	const errors: unknown[] = []
	let loginResult = async () => offline
	const seed = createOwyxPlayProfileSeeder({
		accounts: () => accounts,
		nickname: () => 'Steve',
		login: async (nickname, makeActive) => {
			calls.push({ nickname, makeActive })
			const account = await loginResult()
			accounts.push(account)
			return account
		},
		activate: async (account) => {
			active = account
			changes++
		},
		added: async () => {
			changes++
		},
		onError: (error) => errors.push(error),
	})
	return {
		seed,
		calls,
		accounts,
		errors,
		active: () => active,
		changes: () => changes,
		setLogin: (login: () => Promise<Account>) => (loginResult = login),
	}
}

test('explicit site sign-in adds an offline profile beside Microsoft without switching it', async () => {
	const h = harness([microsoft])
	// The reactive watcher runs before the button resumes after site sign-in.
	const automatic = h.seed()
	const explicit = h.seed(true)
	assert.equal(await automatic, false)
	assert.equal(await explicit, true)
	assert.deepEqual(h.calls, [{ nickname: 'Steve', makeActive: false }])
	assert.deepEqual(h.accounts, [microsoft, offline])
	assert.equal(h.active(), microsoft)
	assert.equal(h.changes(), 1)
})

test('watcher and button share one pending creation and select it when no accounts exist', async () => {
	const h = harness()
	let finish!: (account: Account) => void
	h.setLogin(() => new Promise((resolve) => (finish = resolve)))
	const automatic = h.seed()
	await Promise.resolve()
	const explicit = h.seed(true)
	assert.equal(automatic, explicit)
	assert.equal(h.calls.length, 1)
	finish(offline)
	assert.equal(await explicit, true)
	assert.equal(h.active(), offline)
	assert.equal(h.changes(), 1)
	assert.deepEqual(h.calls, [{ nickname: 'Steve', makeActive: true }])
})

test('explicit sign-in skips an existing matching offline profile', async () => {
	const h = harness([microsoft, offline])
	assert.equal(await h.seed(true), false)
	assert.equal(h.calls.length, 0)
	assert.equal(h.active(), microsoft)
})

test('automatic restoration leaves existing Minecraft profiles alone', async () => {
	const h = harness([microsoft])
	assert.equal(await h.seed(), false)
	assert.equal(h.calls.length, 0)
})

test('explicit sign-in treats offline nickname casing as the same profile', async () => {
	const saved: Account = { profile: { name: 'steve' }, is_offline: true }
	const h = harness([microsoft, saved])
	assert.equal(await h.seed(true), false)
	assert.equal(h.calls.length, 0)
	assert.deepEqual(h.accounts, [microsoft, saved])
	assert.equal(h.active(), microsoft)
	assert.equal(h.changes(), 0)
})

test('failed creation reports once and allows a later retry', async () => {
	const h = harness()
	const failure = new Error('offline login failed')
	h.setLogin(async () => {
		throw failure
	})
	assert.equal(await h.seed(true), false)
	assert.deepEqual(h.errors, [failure])
	h.setLogin(async () => offline)
	assert.equal(await h.seed(true), true)
	assert.equal(h.calls.length, 2)
	assert.equal(h.changes(), 1)
})
