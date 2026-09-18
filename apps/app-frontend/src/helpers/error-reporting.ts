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

	function capture(error: unknown) {
		if (queuedErrors >= 20) return
		queuedErrors++
		const message =
			error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown_error'
		void import('@/helpers/owyx-telemetry')
			.then(({ reportOwyxLauncherError }) =>
				reportOwyxLauncherError(String(message).slice(0, 500), {
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
