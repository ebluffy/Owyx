/**
 * Pure argument guard for `syncOwyxCosmeticsToDisk` (#129 review).
 * Kept free of Tauri/imports so it can be unit-tested with node:test.
 */

export function assertOwyxCosmeticsArgs(
	nickname: unknown,
	cosmetics: unknown,
): asserts nickname is string {
	if (typeof nickname !== 'string' || (nickname && typeof nickname === 'object')) {
		throw new Error('syncOwyxCosmeticsToDisk(nickname, cosmetics): nickname must be a string')
	}
	if (cosmetics != null && typeof cosmetics !== 'object') {
		throw new Error('syncOwyxCosmeticsToDisk(nickname, cosmetics): cosmetics must be an object')
	}
}
