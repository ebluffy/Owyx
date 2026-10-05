/**
 * Wire real auth/API into the pack-updated socket at app bootstrap (P3-b5).
 * Kept separate from owyx-pack-socket.ts so node:test can load the socket module
 * without Vite `@/` aliases.
 */

import { io } from 'socket.io-client'

import { getStoredOwyxApiBase, sanitizeOwyxApiBase } from '@/helpers/owyx-api'
import { installOwyxPackSocketDeps } from '@/helpers/owyx-pack-socket'
import {
	getStoredOwyxSiteSession,
	onOwyxSiteSessionChanged,
	onOwyxSiteSessionCleared,
} from '@/helpers/owyx-site-auth'

export function installDefaultOwyxPackSocketDeps() {
	installOwyxPackSocketDeps({
		io,
		getToken: () => getStoredOwyxSiteSession()?.token?.trim() || '',
		getOrigin: () => {
			const base = sanitizeOwyxApiBase(getStoredOwyxApiBase())
			try {
				return new URL(base).origin
			} catch {
				return base.replace(/\/$/, '')
			}
		},
		onSessionCleared: onOwyxSiteSessionCleared,
		onSessionChanged: onOwyxSiteSessionChanged,
	})
}
