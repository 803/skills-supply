export type IoErrorType = "io_error"

export interface IoError {
	type: IoErrorType
	message: string
	path?: string
	operation?: string
}

export type IoResult<T> = { ok: true; value: T } | { ok: false; error: IoError }

export function ioFailure<T>(
	message: string,
	path?: string,
	operation?: string,
): IoResult<T> {
	return {
		error: {
			message,
			operation,
			path,
			type: "io_error",
		},
		ok: false,
	}
}
