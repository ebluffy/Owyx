import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createModalHolds } from './modal-holds.ts'

test('closing a nested viewer keeps the modal scroll lock and ads hold', () => {
	const transitions: string[] = []
	const modal = createModalHolds(
		() => transitions.push('lock'),
		() => transitions.push('unlock'),
	)
	modal.onShow()
	modal.onShow()
	modal.onHide()
	assert.deepEqual(transitions, ['lock'])
	modal.onHide()
	assert.deepEqual(transitions, ['lock', 'unlock'])
	modal.onHide()
	modal.onShow()
	modal.onHide()
	assert.deepEqual(transitions, ['lock', 'unlock', 'lock', 'unlock'])
})
