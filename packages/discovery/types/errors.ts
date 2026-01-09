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

export interface NetworkError extends BaseError {
	type: "network"
	source: string
	status?: number
	retryable?: boolean
	retryAfterSeconds?: number
	headers?: Record<string, string>
}

export interface NotFoundError extends BaseError {
	type: "not_found"
	target: string
	path?: string
	status?: number
}

export type DiscoveryError =
	| ValidationError
	| ParseError
	| DetectionError
	| IoError
	| NetworkError
	| NotFoundError
