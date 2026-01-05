import {
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
} from "@/types/coerce"
import type { GitRef, ValidatedDeclaration } from "@/types/declaration"
import type { BaseError, Result } from "@/types/error"

type DeclarationValidationError = BaseError & {
	type: "validation"
	source: "manual"
	field: "declaration"
}

type DeclarationParseError = BaseError & {
	type: "parse"
	source: "declaration"
}

function validationError(message: string): DeclarationValidationError {
	return {
		field: "declaration",
		message,
		source: "manual",
		type: "validation",
	}
}

function parseError(message: string, rawError?: Error): DeclarationParseError {
	return {
		message,
		rawError,
		source: "declaration",
		type: "parse",
	}
}

function parseRef(
	value: unknown,
): Result<GitRef | undefined, DeclarationValidationError> {
	if (value === undefined || value === null) {
		return { ok: true, value: undefined }
	}

	if (!value || typeof value !== "object") {
		return { error: validationError("Declaration ref is invalid."), ok: false }
	}

	const record = value as Record<string, unknown>
	const refType = record.type
	const refValue = record.value
	if (typeof refType !== "string" || typeof refValue !== "string") {
		return { error: validationError("Declaration ref is invalid."), ok: false }
	}

	const coercedValue = coerceNonEmpty(refValue)
	if (!coercedValue) {
		return { error: validationError("Declaration ref is invalid."), ok: false }
	}

	switch (refType) {
		case "tag":
			return { ok: true, value: { type: "tag", value: coercedValue } }
		case "branch":
			return { ok: true, value: { type: "branch", value: coercedValue } }
		case "rev":
			return { ok: true, value: { type: "rev", value: coercedValue } }
		default:
			return { error: validationError("Declaration ref is invalid."), ok: false }
	}
}

export function coerceValidatedDeclaration(
	value: unknown,
): Result<ValidatedDeclaration, DeclarationValidationError> {
	if (!value || typeof value !== "object") {
		return { error: validationError("Declaration is invalid."), ok: false }
	}

	const record = value as Record<string, unknown>
	const typeValue = record.type
	if (typeof typeValue !== "string") {
		return { error: validationError("Declaration is missing a type."), ok: false }
	}

	if (typeValue === "registry") {
		if (typeof record.name !== "string" || typeof record.version !== "string") {
			return {
				error: validationError(
					"Registry declaration is missing name or version.",
				),
				ok: false,
			}
		}

		const name = coerceNonEmpty(record.name)
		const version = coerceNonEmpty(record.version)
		const org =
			typeof record.org === "string"
				? (coerceNonEmpty(record.org) ?? undefined)
				: undefined
		if (!name || !version || (record.org && !org)) {
			return {
				error: validationError("Registry declaration has invalid fields."),
				ok: false,
			}
		}

		return {
			ok: true,
			value: {
				name,
				org,
				type: "registry",
				version,
			},
		}
	}

	if (typeValue === "github") {
		if (typeof record.gh !== "string") {
			return {
				error: validationError("GitHub declaration is missing gh."),
				ok: false,
			}
		}

		const gh = coerceGithubRef(record.gh)
		if (!gh) {
			return {
				error: validationError("GitHub declaration has invalid gh."),
				ok: false,
			}
		}

		const pathValue =
			typeof record.path === "string"
				? (coerceNonEmpty(record.path) ?? undefined)
				: undefined
		if (record.path && !pathValue) {
			return {
				error: validationError("GitHub declaration has invalid path."),
				ok: false,
			}
		}

		const refResult = parseRef(record.ref)
		if (!refResult.ok) {
			return refResult
		}

		return {
			ok: true,
			value: {
				gh,
				path: pathValue,
				ref: refResult.value,
				type: "github",
			},
		}
	}

	if (typeValue === "git") {
		if (typeof record.url !== "string") {
			return {
				error: validationError("Git declaration is missing url."),
				ok: false,
			}
		}

		const url = coerceGitUrl(record.url)
		if (!url) {
			return {
				error: validationError("Git declaration has invalid url."),
				ok: false,
			}
		}

		const pathValue =
			typeof record.path === "string"
				? (coerceNonEmpty(record.path) ?? undefined)
				: undefined
		if (record.path && !pathValue) {
			return {
				error: validationError("Git declaration has invalid path."),
				ok: false,
			}
		}

		const refResult = parseRef(record.ref)
		if (!refResult.ok) {
			return refResult
		}

		return {
			ok: true,
			value: {
				path: pathValue,
				ref: refResult.value,
				type: "git",
				url,
			},
		}
	}

	if (typeValue === "local") {
		if (typeof record.path !== "string") {
			return {
				error: validationError("Local declaration is missing path."),
				ok: false,
			}
		}

		const pathValue = coerceAbsolutePathDirect(record.path)
		if (!pathValue) {
			return {
				error: validationError("Local declaration has invalid path."),
				ok: false,
			}
		}

		return { ok: true, value: { path: pathValue, type: "local" } }
	}

	if (typeValue === "claude-plugin") {
		if (typeof record.plugin !== "string" || typeof record.marketplace !== "string") {
			return {
				error: validationError(
					"Claude plugin declaration is missing plugin or marketplace.",
				),
				ok: false,
			}
		}

		const plugin = coerceNonEmpty(record.plugin)
		const marketplace =
			coerceRemoteMarketplaceUrl(record.marketplace) ??
			coerceAbsolutePathDirect(record.marketplace) ??
			coerceGitUrl(record.marketplace) ??
			coerceGithubRef(record.marketplace)
		if (!plugin || !marketplace) {
			return {
				error: validationError("Claude plugin declaration has invalid fields."),
				ok: false,
			}
		}

		return {
			ok: true,
			value: {
				marketplace,
				plugin,
				type: "claude-plugin",
			},
		}
	}

	return {
		error: validationError("Declaration did not match any known type."),
		ok: false,
	}
}

export function parseSerializedDeclaration(
	raw: string,
): Result<ValidatedDeclaration, DeclarationValidationError | DeclarationParseError> {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		return {
			error: parseError(
				"Invalid declaration JSON.",
				error instanceof Error ? error : undefined,
			),
			ok: false,
		}
	}

	return coerceValidatedDeclaration(parsed)
}
