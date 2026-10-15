import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

function setup(kind: 'owyx' | 'microsoft', fail?: 'signOut' | 'remove') {
	const vue = readFileSync(new URL('../components/ui/AccountsCard.vue', import.meta.url), 'utf8')
	const source =
		vue.slice(
			vue.indexOf('function isOwyxPlayAccount('),
			vue.indexOf('function accountTypeLabel('),
		) + vue.slice(vue.indexOf('async function logout('), vue.indexOf('const seedOwyxPlayProfile ='))
	const compiled = ts.transpileModule(source + '\nexport { logout }', {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText
	const microsoft = { profile: { id: 'ms' }, is_offline: false, refresh_token: 'ms-token' }
	const offline = { profile: { id: 'owyx' }, is_offline: true }
	const accounts = { value: [microsoft, offline] }
	let signedIn = true
	const calls: string[] = []
	const exports: { logout?: (id: string) => Promise<void> } = {}
	runInNewContext(compiled, {
		exports,
		accounts,
		selectedAccount: {
			get value() {
				return accounts.value.find((a) => a.profile.id === 'ms')
			},
		},
		owyxSite: {
			signOut: async () => {
				calls.push('signOut')
				if (fail === 'signOut') throw new Error('sign-out failed')
				signedIn = false
			},
		},
		remove_user: async (id: string) => {
			calls.push('remove')
			if (fail === 'remove') throw new Error('remove failed')
			accounts.value = accounts.value.filter((a) => a.profile.id !== id)
		},
		refreshValues: async () => {
			calls.push('refresh')
		},
		setAccount: async () => {
			calls.push('activate')
		},
		seedOwyxPlayProfile: async () => {
			if (signedIn) calls.push('seed')
		},
		emit: () => {
			calls.push('change')
		},
		trackEvent: () => {
			calls.push('analytics')
		},
		handleError: () => {
			calls.push('error')
		},
	})
	return {
		logout: () => exports.logout!(kind === 'owyx' ? 'owyx' : 'ms'),
		accounts,
		signedIn: () => signedIn,
		calls,
	}
}

test('removing Owyx signs out the site before profile refresh and preserves Microsoft', async () => {
	const h = setup('owyx')
	await h.logout()
	assert.equal(h.signedIn(), false)
	assert.deepEqual(
		h.accounts.value.map((a) => a.profile.id),
		['ms'],
	)
	assert.deepEqual(h.calls, ['signOut', 'remove', 'refresh', 'change', 'analytics'])
})

test('removing Microsoft preserves the Owyx session', async () => {
	const h = setup('microsoft')
	await h.logout()
	assert.equal(h.signedIn(), true)
	assert.deepEqual(
		h.accounts.value.map((a) => a.profile.id),
		['owyx'],
	)
	assert.equal(h.calls.includes('signOut'), false)
	assert.equal(h.calls.includes('activate'), true)
})

test('removing the last Owyx profile cannot seed it again from the old session', async () => {
	const h = setup('owyx')
	h.accounts.value = h.accounts.value.filter((a) => a.profile.id === 'owyx')
	await h.logout()
	assert.equal(h.signedIn(), false)
	assert.equal(h.accounts.value.length, 0)
	assert.equal(h.calls.includes('seed'), false)
})

for (const fail of ['signOut', 'remove'] as const) {
	test(`account deletion stops on ${fail} failure`, async () => {
		const h = setup('owyx', fail)
		await h.logout()
		assert.equal(h.accounts.value.length, 2)
		assert.equal(h.calls.includes('refresh'), false)
		assert.equal(h.calls.includes('analytics'), false)
		assert.equal(h.calls.at(-1), 'error')
	})
}
