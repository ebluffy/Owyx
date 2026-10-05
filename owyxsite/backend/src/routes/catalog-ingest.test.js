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
	resolveIngestRollbackUnlink,
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

/**
 * Mock client that replays the ingest write sequence and fails on UPDATE,
 * then serves ROLLBACK TO SAVEPOINT + referenced SELECT (P3-c).
 */
function makeIngestClientMock({ referencedRows = [], failSelect = false, failSavepoint = false } = {}) {
	const calls = []
	return {
		calls,
		async query(sql, params) {
			const text = String(sql)
			calls.push({ text, params })
			if (/^UPDATE\s+packs\s+SET/i.test(text.trim())) {
				const err = new Error('simulated UPDATE failure')
				err.code = 'XX000'
				throw err
			}
			if (/ROLLBACK TO SAVEPOINT ingest_write/i.test(text)) {
				if (failSavepoint) throw new Error('no savepoint')
				return { rows: [] }
			}
			if (/SELECT 1 FROM packs/i.test(text) && /source_config->>'url'/i.test(text)) {
				if (failSelect) throw new Error('connection lost')
				return { rows: referencedRows }
			}
			return { rows: [] }
		},
	}
}

describe('resolveIngestRollbackUnlink (P3-c catch path)', () => {
	it('unlinks after UPDATE failure when catalog does not reference the new file', async () => {
		const client = makeIngestClientMock({ referencedRows: [] })
		// Simulate the write failing first (what the handler catch sees after UPDATE throws).
		await assert.rejects(() => client.query('UPDATE packs SET source_type=$2 WHERE id=$1', ['p1']), /simulated/)

		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, true)
		assert.equal(result.referenced, false)
		assert.equal(result.urlPath, '/uploads/packs/p1-abcdef012345.zip')
		assert.ok(client.calls.some((c) => /ROLLBACK TO SAVEPOINT/i.test(c.text)))
		assert.ok(client.calls.some((c) => /SELECT 1 FROM packs/i.test(c.text)))
		const select = client.calls.find((c) => /SELECT 1 FROM packs/i.test(c.text))
		assert.deepEqual(select.params, ['p1', '/uploads/packs/p1-abcdef012345.zip'])
	})

	it('keeps the file when SELECT finds an existing catalog url', async () => {
		const client = makeIngestClientMock({ referencedRows: [{ '?column?': 1 }] })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, false)
		assert.equal(result.referenced, true)
	})

	it('assumes referenced when SELECT itself fails (safe side)', async () => {
		const client = makeIngestClientMock({ failSelect: true })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, false)
		assert.equal(result.referenced, true)
	})

	it('still runs SELECT when SAVEPOINT rollback is missing', async () => {
		const client = makeIngestClientMock({ failSavepoint: true, referencedRows: [] })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, true)
		assert.ok(client.calls.some((c) => /SELECT 1 FROM packs/i.test(c.text)))
	})
})
