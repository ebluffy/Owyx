/**
 * Human-readable OS label for About / telemetry.
 * Windows 11 still reports kernel 10.0.xxxxx — map build ≥ 22000 → "Windows 11".
 */

export function formatOsDisplayLabel(
	platformRaw: string | undefined | null,
	versionRaw: string | undefined | null,
): string {
	const platform = String(platformRaw || '').toLowerCase()
	const version = String(versionRaw || '').trim()
	if (!platform && !version) return 'Unknown'

	const isWindows = platform === 'windows' || platform.startsWith('win')
	if (isWindows) {
		// Tauri reports e.g. "10.0.22631" or "10.0.22000.1037" — build is the 3rd part.
		const parts = version.split('.')
		const build = parts.length >= 3 ? Number(parts[2]) : NaN
		if (Number.isFinite(build) && build >= 22000) {
			return `Windows 11 (build ${build})`
		}
		if (version.startsWith('10.') || version === '10') {
			return version.includes('.') ? `Windows 10 (${version})` : 'Windows 10'
		}
		return version ? `Windows ${version}` : 'Windows'
	}

	const prettyPlatform =
		platform === 'macos' || platform === 'darwin'
			? 'macOS'
			: platform === 'linux'
				? 'Linux'
				: platform
					? platform.charAt(0).toUpperCase() + platform.slice(1)
					: 'Unknown'
	return version ? `${prettyPlatform} ${version}` : prettyPlatform
}
