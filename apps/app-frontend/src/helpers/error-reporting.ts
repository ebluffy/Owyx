import type { App } from 'vue'
import type { Router } from 'vue-router'

/**
 * Error reporting for Owyx. Never initializes Modrinth's Sentry DSN.
 * When the user opts into settings.telemetry, sanitized errors go to api.owyx.site.
 */
export function setupErrorReporting(app: App, _router: Router): void {
	if (!import.meta.env.PROD) return

	const previousHandler = app.config.errorHandler
	let queuedErrors = 0
	const recentFingerprints = new Map<string, number>()
	const DEDUPE_MS = 60_000
	const MAX_UNIQUE_PER_MINUTE = 8

	function isNoisy(message: string): boolean {
		return /^The resource id \d+ is invalid\.?$/i.test(message.trim())
	}

	function shouldSkip(message: string): boolean {
		if (isNoisy(message)) return true
		const now = Date.now()
		for (const [key, ts] of recentFingerprints) {
			if (now - ts > DEDUPE_MS) recentFingerprints.delete(key)
		}
		if (recentFingerprints.has(message)) return true
		if (recentFingerprints.size >= MAX_UNIQUE_PER_MINUTE) return true
		recentFingerprints.set(message, now)
		return false
	}

	function capture(error: unknown) {
		if (queuedErrors >= 20) return
		const message =
			error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown_error'
		const text = String(message).slice(0, 500)
		if (shouldSkip(text)) return
		queuedErrors++
		void import('@/helpers/owyx-telemetry')
			.then(({ reportOwyxLauncherError }) =>
				reportOwyxLauncherError(text, {
					metadata: { source: 'vue_error_handler' },
				}),
			)
			.catch(() => {})
			.finally(() => {
				queuedErrors--
			})
	}

	function onError(event: ErrorEvent) {
		capture(event.error ?? event.message)
	}

	function onRejection(event: PromiseRejectionEvent) {
		capture(event.reason)
	}

	app.config.errorHandler = (error, instance, info) => {
		if (previousHandler) previousHandler(error, instance, info)
		else console.error(error)
		capture(error)
	}
	window.addEventListener('error', onError)
	window.addEventListener('unhandledrejection', onRejection)
	app.onUnmount(() => {
		window.removeEventListener('error', onError)
		window.removeEventListener('unhandledrejection', onRejection)
	})
}
