/**
 * Coerce Tauri/serde byte payloads (often plain number[]) into a real Uint8Array.
 */
export function asUint8Array(data: ArrayLike<number> | ArrayBuffer | Uint8Array): Uint8Array {
	if (data instanceof Uint8Array) {
		return data
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data)
	}
	return Uint8Array.from(data)
}

/** Build a PNG Blob without relying on `.buffer.slice` (broken for plain number[]). */
export function pngBytesToBlob(data: ArrayLike<number> | ArrayBuffer | Uint8Array): Blob {
	return new Blob([asUint8Array(data)], { type: 'image/png' })
}
