/**
 * Export a Discord-support diagnostics zip (report + recent launcher logs).
 */

import { save } from '@tauri-apps/plugin-dialog'

import {
	getOwyxClientKey,
	getStoredOwyxApiBase,
	sanitizeOwyxApiBase,
} from '@/helpers/owyx-api'
import { get } from '@/helpers/settings'
import { exportOwyxDiagnosticsZip, getOS, highlightInFolder } from '@/helpers/utils.js'

function redactClientKey(key: string): string {
	const trimmed = key.trim()
	if (!trimmed) return '(empty)'
	if (trimmed.length <= 8) return '****'
	return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (len=${trimmed.length})`
}

export async function exportOwyxDiagnosticsReport(): Promise<string | null> {
	const settings = await get().catch(() => null)
	const os = await getOS().catch(() => 'unknown')
	const apiBase = sanitizeOwyxApiBase(getStoredOwyxApiBase())
	const key = getOwyxClientKey()
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const body = [
		'Owyx launcher diagnostics',
		`Generated: ${new Date().toISOString()}`,
		'',
		'Environment',
		`- OS: ${os}`,
		`- Custom dir: ${settings?.custom_dir ?? '(default)'}`,
		'',
		'Owyx API',
		`- Base URL: ${apiBase}`,
		`- Client key: ${redactClientKey(key)}`,
		'',
		'This zip includes owyx-diagnostics.txt plus recent launcher_logs files.',
		'Do not paste real client keys into Discord.',
		'',
	].join('\n')

	const path = await save({
		defaultPath: `owyx-diagnostics-${stamp}.zip`,
		filters: [{ name: 'Zip archive', extensions: ['zip'] }],
	})
	if (!path) return null
	await exportOwyxDiagnosticsZip(path, body)
	await highlightInFolder(path).catch(() => undefined)
	return path
}
