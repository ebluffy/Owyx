/**
 * E2 ingest helpers (no DB).
 * Run: node --test owyxsite/backend/src/routes/catalog-ingest.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { packIngestFinalName, packVersionShaConflict } = require('./catalog')

describe('packIngestFinalName', () => {
	it('uses content-addressed name with sha prefix', () => {
		const sha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
		assert.equal(packIngestFinalName('liminal', sha, 'mrpack'), 'liminal-abcdef012345.mrpack')
		assert.equal(packIngestFinalName('pack-1', sha, 'zip'), 'pack-1-abcdef012345.zip')
	})
})

describe('packVersionShaConflict', () => {
	it('allows first publish and identical re-upload', () => {
		assert.equal(packVersionShaConflict(null, 'aaa'), false)
		assert.equal(packVersionShaConflict('aaa', 'aaa'), false)
	})

	it('rejects same version with different sha (409 path)', () => {
		assert.equal(packVersionShaConflict('aaa', 'bbb'), true)
	})
})
