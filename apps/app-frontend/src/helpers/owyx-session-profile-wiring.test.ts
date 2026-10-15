import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

function setup(existingOffline: boolean) {
	const vue = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
	const source = vue.slice(
		vue.indexOf('async function refreshOwyxSiteSession()'),
		vue.indexOf('async function signOutOwyxSiteAccount()'),
	)
	const compiled = ts.transpileModule(source + '\nexport { refreshOwyxSiteSession }', {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText
	const session = { token: 'test-token', user: { nickname: 'Steve' } }
	const microsoft = { profile: { name: 'Steve', id: 'microsoft' }, is_offline: false, active: true }
	const offline = { profile: { name: 'Steve', id: 'offline' }, is_offline: true, active: false }
	const list = existingOffline ? [microsoft, offline] : [microsoft]
	let visible = [microsoft]
	const logins: boolean[] = []
	const presence: boolean[] = []
	let finishSocial!: (value: { sharePresence: boolean }) => void
	const social = new Promise((resolve) => (finishSocial = resolve))
	const exports: { refreshOwyxSiteSession?: () => Promise<void> } = {}
	runInNewContext(compiled, {
		exports,
		console: { warn: () => undefined },
		hydrateOwyxSiteSession: async () => undefined,
		getStoredOwyxSiteSession: () => session,
		fetchOwyxSiteMe: async () => session,
		owyxSiteSession: { value: null },
		stopOwyxPresenceHeartbeat: () => undefined,
		resetOwyxSharePresencePreference: () => undefined,
		setOwyxSharePresenceEnabled: (enabled: boolean) => presence.push(enabled),
		accounts: {
			value: {
				refreshAccounts: async () => {
					visible = [...list]
				},
			},
		},
		login_offline: async (_nick: string, active: boolean) => {
			logins.push(active)
			list.push(offline)
		},
		remove_user: async () => assert.fail('Matching account must not be removed'),
		set_default_user: async () => assert.fail('Active Microsoft must not change'),
		require: (id: string) => {
			if (id === '@/helpers/auth') return { users: async () => list }
			if (id === '@/helpers/owyx-friends') return { getOwyxSocialSettings: () => social }
			if (id === '@/helpers/onboarding-checklist')
				return { markLoggedIntoOwyxSite: async () => undefined }
			assert.fail(`Unexpected dependency ${id}`)
		},
	})
	return {
		refresh: exports.refreshOwyxSiteSession!,
		visible: () => visible,
		logins,
		presence,
		finishSocial,
	}
}

for (const existing of [false, true]) {
	test(`site session refresh publishes ${existing ? 'existing' : 'new'} play profile before slow social request`, async () => {
		const h = setup(existing)
		const pending = h.refresh()
		for (let i = 0; i < 20; i++) await Promise.resolve()
		assert.equal(h.visible().length, 2)
		assert.equal(h.visible()[0].active, true)
		assert.deepEqual(h.logins, existing ? [] : [false])
		assert.deepEqual(h.presence, [false])
		h.finishSocial({ sharePresence: false })
		await pending
	})
}
