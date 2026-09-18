/**
 * Export a Discord-support diagnostics text file (API base + redacted key + env).
 * Opens the launcher logs folder so the user can attach recent session logs.
 */

import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

import {
	getOwyxClientKey,
	getStoredOwyxApiBase,
	sanitizeOwyxApiBase,
} from '@/helpers/owyx-api'
import { get } from '@/helpers/settings'
import { getOS, showLauncherLogsFolder } from '@/helpers/utils.js'

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
		'Attach recent files from the launcher_logs folder (opened after save).',
		'Do not paste real client keys into Discord.',
		'',
	].join('\n')

	const path = await save({
		defaultPath: `owyx-diagnostics-${stamp}.txt`,
		filters: [{ name: 'Text', extensions: ['txt'] }],
	})
	if (!path) return null
	await writeTextFile(path, body)
	await showLauncherLogsFolder().catch(() => undefined)
	return path
}
