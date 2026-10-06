/** Unwrap Tauri invoke rejections (`{ message }` / string) into a real `Error`. */
export function tauriInvokeError(err: unknown): Error {
	if (err instanceof Error) return err
	if (err && typeof err === 'object' && 'message' in err) {
		const message = String((err as { message?: unknown }).message ?? '')
		if (message.trim()) return new Error(message)
	}
	if (typeof err === 'string' && err.trim()) return new Error(err)
	try {
		return new Error(JSON.stringify(err))
	} catch {
		return new Error('Unknown launcher error')
	}
}
