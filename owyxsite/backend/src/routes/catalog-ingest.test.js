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
	normalizeSource,
	mergePackSourceForUpdate,
} = require('./catalog')

describe('mergePackSourceForUpdate (AR-11b)', () => {
	const sha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
	const prev = {
		source_type: 'mrpack',
		source_config: {
			url: 'https://api.owyx.site/uploads/packs/x.mrpack',
			sha256: sha,
			size: 1234567,
			ingest: 'local',
			sourceInstanceHint: 'My Instance',
		},
	}

	it('published:true without source leaves config unchanged', () => {
		const out = mergePackSourceForUpdate(prev, { published: true })
		assert.equal(out.sourceTouched, false)
		assert.equal(out.sourceType, 'mrpack')
		assert.equal(out.sourceConfig.sha256, sha)
		assert.equal(out.sourceConfig.size, 1234567)
		assert.equal(out.sourceConfig.ingest, 'local')
		assert.equal(out.sourceConfig.sourceInstanceHint, 'My Instance')
	})

	it('mrpack source with same url keeps sha256/size/ingest/hint', () => {
		const out = mergePackSourceForUpdate(prev, {
			source: { type: 'mrpack', config: { url: prev.source_config.url } },
		})
		assert.equal(out.sourceTouched, true)
		assert.equal(out.sourceType, 'mrpack')
		assert.equal(out.sourceConfig.url, prev.source_config.url)
		assert.equal(out.sourceConfig.sha256, sha)
		assert.equal(out.sourceConfig.size, 1234567)
		assert.equal(out.sourceConfig.ingest, 'local')
		assert.equal(out.sourceConfig.sourceInstanceHint, 'My Instance')
	})

	it('mrpack with different url and stale sha256 drops sha256 (AR-14)', () => {
		const out = mergePackSourceForUpdate(prev, {
			source: {
				type: 'mrpack',
				config: {
					url: 'https://cdn.example.com/other.mrpack',
					sha256: sha,
				},
			},
		})
		assert.equal(out.sourceTouched, true)
		assert.equal(out.sourceConfig.url, 'https://cdn.example.com/other.mrpack')
		assert.equal(out.sourceConfig.sha256, undefined)
		assert.equal(out.sourceConfig.size, undefined)
		assert.equal(out.sourceConfig.ingest, 'planned')
		assert.equal(out.sourceConfig.sourceInstanceHint, undefined)
	})

	it('url changed does not carry size/ingest/hint from prev', () => {
		const out = mergePackSourceForUpdate(prev, {
			source: { type: 'mrpack', config: { url: 'https://cdn.example.com/other.mrpack' } },
		})
		assert.equal(out.sourceConfig.size, undefined)
		assert.equal(out.sourceConfig.ingest, 'planned')
		assert.equal(out.sourceConfig.sourceInstanceHint, undefined)
		assert.equal(out.sourceConfig.sha256, undefined)
	})

	it('url changed keeps a newly typed sha256 that differs from prev', () => {
		const newSha = '1111111111111111111111111111111111111111111111111111111111111111'
		const out = mergePackSourceForUpdate(prev, {
			source: {
				type: 'mrpack',
				config: {
					url: 'https://cdn.example.com/other.mrpack',
					sha256: newSha,
				},
			},
		})
		assert.equal(out.sourceConfig.sha256, newSha)
	})
})

describe('normalizeSource mrpack (AR-11)', () => {
	it('preserves sha256, size, and sourceInstanceHint from ingest', () => {
		const sha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
		const out = normalizeSource('mrpack', {
			url: 'https://api.owyx.site/uploads/packs/x.mrpack',
			sha256: sha,
			size: 1234567,
			ingest: 'local',
			sourceInstanceHint: 'My Instance',
		})
		assert.equal(out.type, 'mrpack')
		assert.equal(out.config.url, 'https://api.owyx.site/uploads/packs/x.mrpack')
		assert.equal(out.config.ingest, 'local')
		assert.equal(out.config.sha256, sha)
		assert.equal(out.config.size, 1234567)
		assert.equal(out.config.sourceInstanceHint, 'My Instance')
	})

	it('keeps url+ingest when optional fields are absent', () => {
		const out = normalizeSource('mrpack', {
			url: 'https://cdn.example.com/pack.mrpack',
			ingest: 'planned',
		})
		assert.equal(out.config.sha256, undefined)
		assert.equal(out.config.size, undefined)
		assert.equal(out.config.ingest, 'planned')
	})
})

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
 * Mock client for the ingest catch path after an UPDATE already failed (P3-c).
 * Call order under test: ROLLBACK TO SAVEPOINT → referenced SELECT → unlink decision.
 */
function makeRollbackClientMock({ referencedRows = [], failSelect = false } = {}) {
	const calls = []
	return {
		calls,
		async query(sql, params) {
			const text = String(sql)
			calls.push({ text, params })
			if (/ROLLBACK TO SAVEPOINT ingest_write/i.test(text)) {
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
	it('runs SAVEPOINT rollback then SELECT; unlinks when catalog does not reference the file', async () => {
		const client = makeRollbackClientMock({ referencedRows: [] })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, true)
		assert.equal(result.referenced, false)
		assert.equal(result.urlPath, '/uploads/packs/p1-abcdef012345.zip')
		assert.equal(client.calls.length, 2)
		assert.match(client.calls[0].text, /ROLLBACK TO SAVEPOINT/i)
		assert.match(client.calls[1].text, /SELECT 1 FROM packs/i)
		assert.deepEqual(client.calls[1].params, ['p1', '/uploads/packs/p1-abcdef012345.zip'])
	})

	it('keeps the file when SELECT finds an existing catalog url', async () => {
		const client = makeRollbackClientMock({ referencedRows: [{ '?column?': 1 }] })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, false)
		assert.equal(result.referenced, true)
	})

	it('assumes referenced when SELECT itself fails (safe side)', async () => {
		const client = makeRollbackClientMock({ failSelect: true })
		const result = await resolveIngestRollbackUnlink(client, {
			packId: 'p1',
			createdFinalPath: '/data/uploads/packs/p1-abcdef012345.zip',
		})
		assert.equal(result.shouldUnlink, false)
		assert.equal(result.referenced, true)
	})
})
