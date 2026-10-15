import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'
import { reactive } from 'vue'

import { createInstanceLauncher } from './instance-launch.ts'

function setup() {
	const starting = reactive(new Set<string>())
	const calls: { command: string; args: unknown }[] = []
	let finish!: (value: unknown) => void
	const invoke = (command: string, args: unknown) => {
		calls.push({ command, args })
		return new Promise((resolve) => (finish = resolve))
	}
	const run = createInstanceLauncher(
		(instanceId, serverAddress) => invoke('instance_run', { instanceId, serverAddress }),
		starting,
	)
	const exports: Record<string, (id: string, target: string) => Promise<unknown>> = {}
	const source = readFileSync(new URL('./worlds.ts', import.meta.url), 'utf8')
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText
	runInNewContext(compiled, {
		exports,
		require: (id: string) => {
			if (id === '@tauri-apps/api/core') return { invoke }
			if (id === '@/helpers/instance') return { trackInstanceLaunch: run.track }
			if (id === '@/helpers/utils') return {}
			if (id === '@sfirew/minecraft-motd-parser' || id === 'dayjs') return {}
			assert.fail(`Unexpected dependency ${id}`)
		},
	})
	return { starting, calls, run, worlds: exports, finish: (value: unknown) => finish(value) }
}

for (const operation of ['start_join_server', 'start_join_singleplayer_world']) {
	test(`${operation} shares pending state and the native request with instance Play`, async () => {
		const h = setup()
		const world = h.worlds[operation]('mc', 'target')
		assert.equal(h.starting.has('mc'), true)
		const play = h.run('mc')
		await Promise.resolve()
		assert.equal(h.calls.length, 1)
		assert.equal(h.calls[0].command, `plugin:worlds|${operation}`)
		h.finish('process')
		await Promise.all([world, play])
		assert.equal(h.starting.has('mc'), false)
	})
}

test('a world click during instance Play does not issue a second native launch', async () => {
	const h = setup()
	const play = h.run('mc')
	const world = h.worlds.start_join_server('mc', 'example.org')
	await Promise.resolve()
	assert.equal(h.calls.length, 1)
	assert.equal(h.calls[0].command, 'instance_run')
	h.finish('process')
	await Promise.all([play, world])
	assert.equal(h.starting.has('mc'), false)
})
