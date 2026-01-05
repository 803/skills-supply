import type { AbsolutePath, BaseError } from "@skills-supply/core"
import type { ZodError } from "zod"

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

export interface ParseError extends BaseError {
	type: "parse"
	source: string
	path?: AbsolutePath
}

export interface DetectionError extends BaseError {
	type: "detection"
	path: AbsolutePath
}

export interface IoError extends BaseError {
	type: "io"
	path: AbsolutePath
	operation: string
}

export interface ConflictError extends BaseError {
	type: "conflict"
	target: string
	path?: AbsolutePath
}

export interface NotFoundError extends BaseError {
	type: "not_found"
	target: string
	path?: AbsolutePath
}

export interface NetworkError extends BaseError {
	type: "network"
	source: string
	status?: number
	retryable?: boolean
}

export type SkError =
	| ValidationError
	| ParseError
	| DetectionError
	| IoError
	| ConflictError
	| NotFoundError
	| NetworkError
