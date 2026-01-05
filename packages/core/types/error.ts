import type { ZodError } from "zod"
import type { AbsolutePath } from "@/types/branded"

export interface BaseError {
	type: string
	message: string
	cause?: BaseError
	rawError?: Error
}

export type ValidationError =
	| (BaseError & {
			type: "validation"
			source: "zod"
			field: string
			path?: AbsolutePath
			zodError: ZodError
	  })
	| (BaseError & {
			type: "validation"
			source: "manual"
			field: string
			path?: AbsolutePath
	  })

export type ParseError = BaseError & {
	type: "parse"
	source: string
	path?: AbsolutePath
}

export type DetectionError = BaseError & {
	type: "detection"
	path: AbsolutePath
}

export type IoError = BaseError & {
	type: "io"
	path: AbsolutePath
	operation: string
}

export type NotFoundError = BaseError & {
	type: "not_found"
	target: string
	path?: AbsolutePath
}

export type CoreError =
	| ValidationError
	| ParseError
	| DetectionError
	| IoError
	| NotFoundError

export type Result<T, E extends BaseError = CoreError> =
	| { ok: true; value: T }
	| { ok: false; error: E }
