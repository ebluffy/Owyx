import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatOsDisplayLabel } from './owyx-os-label.ts'

describe('formatOsDisplayLabel', () => {
	it('maps Windows build 26200 to Windows 11', () => {
		assert.equal(formatOsDisplayLabel('windows', '10.0.26200'), 'Windows 11 (build 26200)')
	})

	it('maps Windows build 19045 to Windows 10', () => {
		assert.equal(formatOsDisplayLabel('windows', '10.0.19045'), 'Windows 10 (10.0.19045)')
	})

	it('maps Windows build 22000 with revision to Windows 11', () => {
		assert.equal(formatOsDisplayLabel('windows', '10.0.22000.1037'), 'Windows 11 (build 22000)')
	})

	it('labels macOS and Linux', () => {
		assert.equal(formatOsDisplayLabel('macos', '14.5'), 'macOS 14.5')
		assert.equal(formatOsDisplayLabel('linux', '6.8'), 'Linux 6.8')
	})

	it('falls back to Unknown with no input', () => {
		assert.equal(formatOsDisplayLabel('', ''), 'Unknown')
	})
})
