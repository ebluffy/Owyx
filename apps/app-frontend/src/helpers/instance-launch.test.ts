import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computed, reactive } from 'vue'

import { createInstanceLauncher } from './instance-launch.ts'

test('navigation observes a pending launch and a second click shares the native request', async () => {
	const starting = reactive(new Set<string>())
	let finish!: (value: unknown) => void
	let calls = 0
	const run = createInstanceLauncher(() => {
		calls++
		return new Promise((resolve) => (finish = resolve))
	}, starting)
	const home = computed(() => starting.has('mc'))
	const first = run('mc')
	const instancePage = computed(() => starting.has('mc'))
	assert.equal(home.value, true)
	assert.equal(instancePage.value, true)
	assert.equal(run('mc'), first)
	await Promise.resolve()
	assert.equal(calls, 1)
	finish('process-id')
	assert.equal(await first, 'process-id')
	assert.equal(home.value, false)
	assert.equal(instancePage.value, false)
})

test('failed launches clear the state and allow retry', async () => {
	const starting = new Set<string>()
	let calls = 0
	const run = createInstanceLauncher(async () => {
		if (++calls === 1) throw new Error('auth failed')
		return 'process-id'
	}, starting)
	await assert.rejects(run('mc'), /auth failed/)
	assert.equal(starting.has('mc'), false)
	assert.equal(await run('mc'), 'process-id')
	assert.equal(calls, 2)
})

test('independent instances can start together and retain their server addresses', async () => {
	const starting = new Set<string>()
	const calls: [string, string | null][] = []
	const run = createInstanceLauncher(async (id, address) => {
		calls.push([id, address])
		return id
	}, starting)
	const a = run('a', 'example.org')
	const b = run('b')
	assert.equal(starting.size, 2)
	await Promise.all([a, b])
	assert.deepEqual(calls, [
		['a', 'example.org'],
		['b', null],
	])
	assert.equal(starting.size, 0)
})
