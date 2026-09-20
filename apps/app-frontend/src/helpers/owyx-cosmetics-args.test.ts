import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertOwyxCosmeticsArgs } from './owyx-cosmetics-args.ts'

describe('assertOwyxCosmeticsArgs', () => {
	it('accepts a nickname string + cosmetics object', () => {
		assert.doesNotThrow(() => assertOwyxCosmeticsArgs('Steve', { skinUrl: '/x.png' }))
	})

	it('accepts an empty nickname with null cosmetics', () => {
		assert.doesNotThrow(() => assertOwyxCosmeticsArgs('', null))
	})

	it('rejects swapped args (cosmetics first)', () => {
		assert.throws(
			() => assertOwyxCosmeticsArgs({ skinUrl: '/x.png' }, 'Steve'),
			/nickname must be a string/,
		)
	})

	it('rejects a non-object cosmetics value', () => {
		assert.throws(
			() => assertOwyxCosmeticsArgs('Steve', 'not-an-object'),
			/cosmetics must be an object/,
		)
	})
})
