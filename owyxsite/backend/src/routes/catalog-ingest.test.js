/**
 * E2 ingest helpers (no DB).
 * Run: node --test owyxsite/backend/src/routes/catalog-ingest.test.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	packIngestFinalName,
	packVersionShaConflict,
	planIngestFile,
	shouldUnlinkCreatedIngestFile,
} = require('./catalog')

describe('packIngestFinalName', () => {
	it('uses content-addressed name with sha prefix', () => {
		const sha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
		assert.equal(packIngestFinalName('liminal', sha, 'mrpack'), 'liminal-abcdef012345.mrpack')
		assert.equal(packIngestFinalName('pack-1', sha, 'zip'), 'pack-1-abcdef012345.zip')
	})

	it('keeps the same path for identical content (safe re-upload)', () => {
		const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		assert.equal(packIngestFinalName('x', sha, 'zip'), packIngestFinalName('x', sha, 'zip'))
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

describe('planIngestFile (E2-b2)', () => {
	it('reuses live file and does not track rollback when final already exists', () => {
		assert.deepEqual(planIngestFile({ finalExists: true }), {
			rename: false,
			trackCreatedForRollback: false,
		})
	})

	it('renames and tracks created path when final is missing', () => {
		assert.deepEqual(planIngestFile({ finalExists: false }), {
			rename: true,
			trackCreatedForRollback: true,
		})
	})
})

describe('shouldUnlinkCreatedIngestFile (P3-j2)', () => {
	it('unlinks orphans that are not referenced by packs.source_config', () => {
		assert.equal(shouldUnlinkCreatedIngestFile({ referenced: false }), true)
	})

	it('keeps the file when catalog already points at it', () => {
		assert.equal(shouldUnlinkCreatedIngestFile({ referenced: true }), false)
	})
})
