export function createModalHolds(onFirstShow: () => void, onLastHide: () => void) {
	let holds = 0
	return {
		onShow() {
			if (++holds === 1) onFirstShow()
		},
		onHide() {
			if (holds > 0 && --holds === 0) onLastHide()
		},
	}
}
