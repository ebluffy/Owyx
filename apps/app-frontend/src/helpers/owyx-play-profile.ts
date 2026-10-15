type PlayProfile = {
	profile: { name: string }
	is_offline?: boolean
}

export function createOwyxPlayProfileSeeder<T extends PlayProfile>(deps: {
	accounts: () => T[]
	nickname: () => string
	login: (nickname: string, makeActive: boolean) => Promise<T | undefined>
	activate: (account: T) => Promise<void>
	added: () => Promise<void>
	onError: (error: unknown) => void
}) {
	let inFlight: Promise<boolean> | undefined

	return function seed(explicit = false): Promise<boolean> {
		const accounts = deps.accounts()
		// Automatic restoration must not block an explicit add beside a Microsoft account.
		if (!explicit && accounts.length > 0) return Promise.resolve(false)
		if (inFlight) return inFlight
		const nick = deps.nickname()
		if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return Promise.resolve(false)
		if (
			accounts.some(
				(account) =>
					account.is_offline && account.profile.name.toLowerCase() === nick.toLowerCase(),
			)
		) {
			return Promise.resolve(false)
		}
		const makeActive = accounts.length === 0
		inFlight = Promise.resolve()
			.then(async () => {
				const account = await deps.login(nick, makeActive)
				if (!account) return false
				if (makeActive) await deps.activate(account)
				else await deps.added()
				return true
			})
			.catch((error: unknown) => {
				deps.onError(error)
				return false
			})
			.finally(() => {
				inFlight = undefined
			})
		return inFlight
	}
}
