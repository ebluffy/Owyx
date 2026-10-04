import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { asUint8Array, pngBytesToBlob } from './owyx-bytes.ts'

describe('asUint8Array', () => {
	it('keeps an existing Uint8Array', () => {
		const input = new Uint8Array([1, 2, 3])
		assert.equal(asUint8Array(input), input)
	})

	it('converts a plain number[] (Tauri Bytes shape)', () => {
		const out = asUint8Array([137, 80, 78, 71])
		assert.ok(out instanceof Uint8Array)
		assert.deepEqual([...out], [137, 80, 78, 71])
		assert.ok(out.buffer instanceof ArrayBuffer)
	})

	it('wraps an ArrayBuffer', () => {
		const buf = new Uint8Array([9, 8, 7]).buffer
		const out = asUint8Array(buf)
		assert.ok(out instanceof Uint8Array)
		assert.deepEqual([...out], [9, 8, 7])
	})
})

describe('pngBytesToBlob', () => {
	it('builds a PNG blob from number[] without .buffer.slice', async () => {
		const blob = pngBytesToBlob([1, 2, 3, 4])
		assert.equal(blob.type, 'image/png')
		assert.equal(blob.size, 4)
		const bytes = new Uint8Array(await blob.arrayBuffer())
		assert.deepEqual([...bytes], [1, 2, 3, 4])
	})

	it('builds a PNG blob from Uint8Array', async () => {
		const blob = pngBytesToBlob(new Uint8Array([5, 6]))
		assert.equal(blob.type, 'image/png')
		assert.equal(blob.size, 2)
	})
})
