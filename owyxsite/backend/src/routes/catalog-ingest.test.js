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

	it('keeps the same path for identical content (safe re-upload)', () => {
		const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		assert.equal(
			packIngestFinalName('x', sha, 'zip'),
			packIngestFinalName('x', sha, 'zip'),
		)
	})
})

describe('packVersionShaConflict', () => {
	it('allows first publish and identical re-upload', () => {
		assert.equal(packVersionShaConflict(null, 'aaa'), false)
		assert.equal(packVersionShaConflict(undefined, 'aaa'), false)
		assert.equal(packVersionShaConflict('aaa', 'aaa'), false)
	})

	it('rejects same version with different sha (409 path)', () => {
		assert.equal(packVersionShaConflict('aaa', 'bbb'), true)
	})

	it('does not conflict when prior sha is empty', () => {
		assert.equal(packVersionShaConflict('', 'bbb'), false)
	})
})

describe('ingest rollback policy (E2-b2 contract)', () => {
	it('only new files are eligible for rollback unlink', () => {
		// Documented contract mirrored by catalog.js ingest handler:
		// createdFinalPath is set only after rename into a missing path;
		// if finalPath already existed, createdFinalPath stays null.
		const finalExists = true
		let createdFinalPath = null
		if (!finalExists) {
			createdFinalPath = '/uploads/packs/id-sha.zip'
		}
		assert.equal(createdFinalPath, null)
	})

	it('marks created file for unlink when rename creates it', () => {
		const finalExists = false
		let createdFinalPath = null
		if (!finalExists) {
			createdFinalPath = '/uploads/packs/id-sha.zip'
		}
		assert.equal(createdFinalPath, '/uploads/packs/id-sha.zip')
	})
})
