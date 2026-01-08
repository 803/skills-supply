import type { BaseError } from "@skills-supply/core"
import type { ZodError } from "zod"

export type ValidationError =
	| (BaseError & {
			type: "validation"
			source: "zod"
			field: string
			path?: string
			zodError: ZodError
	  })
	| (BaseError & {
			type: "validation"
			source: "manual"
			field: string
			path?: string
	  })

export interface ParseError extends BaseError {
	type: "parse"
	source: string
	path?: string
}

export interface DetectionError extends BaseError {
	type: "detection"
	path: string
}

export interface IoError extends BaseError {
	type: "io"
	path: string
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
}

export type DiscoveryError =
	| ValidationError
	| ParseError
	| DetectionError
	| IoError
	| NetworkError
	| NotFoundError
