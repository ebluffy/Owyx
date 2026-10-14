export function createInstanceLauncher(
	invoke: (instanceId: string, serverAddress: string | null) => Promise<unknown>,
	starting: Set<string>,
) {
	const pending = new Map<string, Promise<unknown>>()
	return (instanceId: string, serverAddress: string | null = null): Promise<unknown> => {
		const existing = pending.get(instanceId)
		if (existing) return existing
		starting.add(instanceId)
		const request = Promise.resolve()
			.then(() => invoke(instanceId, serverAddress))
			.finally(() => {
				pending.delete(instanceId)
				starting.delete(instanceId)
			})
		pending.set(instanceId, request)
		return request
	}
}
