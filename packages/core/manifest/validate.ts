import { parse } from "@skills-supply/agents-toml"
import { ZodError } from "zod"
import { adaptManifest } from "@/manifest/adapter"
import type { AbsolutePath } from "@/types/branded"
import type { ManifestInfo } from "@/types/content"
import type { BaseError, Result } from "@/types/error"

export function validateManifest(
	contents: string,
	manifestPath: AbsolutePath,
): Result<ManifestInfo> {
	const parsed = parse(contents)
	if (!parsed.ok) {
		const cause = coerceBaseError(parsed.error.cause)
		if (parsed.error.type === "invalid_toml") {
			return {
				error: {
					cause,
					message: `Invalid TOML: ${parsed.error.message}`,
					path: manifestPath,
					rawError:
						parsed.error.cause instanceof Error
							? parsed.error.cause
							: undefined,
					source: "agents.toml",
					type: "parse",
				},
				ok: false,
			}
		}

		const field =
			parsed.error.type === "invalid_dependency" ? "dependencies" : "manifest"
		const rawError =
			parsed.error.cause instanceof Error ? parsed.error.cause : undefined
		if (rawError instanceof ZodError) {
			return {
				error: {
					cause,
					field,
					message: parsed.error.message,
					path: manifestPath,
					rawError,
					source: "zod",
					type: "validation",
					zodError: rawError,
				},
				ok: false,
			}
		}

		return {
			error: {
				cause,
				field,
				message: parsed.error.message,
				path: manifestPath,
				rawError,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return adaptManifest(parsed.value, manifestPath)
}

function coerceBaseError(value: unknown): BaseError | undefined {
	if (!value || typeof value !== "object") {
		return undefined
	}

	const record = value as {
		type?: unknown
		message?: unknown
		cause?: unknown
		rawError?: unknown
	}
	if (typeof record.type !== "string" || typeof record.message !== "string") {
		if (value instanceof Error) {
			return { message: value.message, rawError: value, type: "unexpected" }
		}
		return undefined
	}

	const cause = coerceBaseError(record.cause)
	return {
		cause,
		message: record.message,
		rawError: record.rawError instanceof Error ? record.rawError : undefined,
		type: record.type,
	}
}
