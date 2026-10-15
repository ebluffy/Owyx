export function createInstanceLauncher(
	invoke: (instanceId: string, serverAddress: string | null) => Promise<unknown>,
	starting: Set<string>,
) {
	const pending = new Map<string, Promise<unknown>>()
	const track = (instanceId: string, launch: () => Promise<unknown>): Promise<unknown> => {
		const existing = pending.get(instanceId)
		if (existing) return existing
		starting.add(instanceId)
		const request = Promise.resolve()
			.then(launch)
			.finally(() => {
				pending.delete(instanceId)
				starting.delete(instanceId)
			})
		pending.set(instanceId, request)
		return request
	}
	return Object.assign(
		(instanceId: string, serverAddress: string | null = null) =>
			track(instanceId, () => invoke(instanceId, serverAddress)),
		{ track },
	)
}
