/**
 * Coercion Functions for Branded Types
 *
 * These are the ONLY functions that should create branded type values.
 * They validate and transform raw strings into guaranteed-valid branded types.
 *
 * Pattern: Returns the branded value on success, null on failure.
 * Use Result-returning wrappers when you need error messages.
 */

import path from "node:path"
import type {
	AbsolutePath,
	Alias,
	GithubRef,
	GitRef,
	NonEmptyString,
	NormalizedGitUrl,
} from "./branded.js"

// === NON-EMPTY STRING ===

/**
 * Coerce a string to NonEmptyString.
 * Trims whitespace and rejects empty strings.
 */
export function coerceNonEmpty(s: string): NonEmptyString | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null
	return trimmed as NonEmptyString
}

/**
 * Type guard for NonEmptyString.
 */
export function isNonEmpty(s: string): s is NonEmptyString {
	return coerceNonEmpty(s) !== null
}

// === ALIAS ===

// Characters not allowed in aliases
const ALIAS_INVALID_CHARS = /[/\\.:]/

/**
 * Coerce a string to Alias.
 * Must be non-empty, no slashes, no dots, no colons, no backslashes.
 */
export function coerceAlias(s: string): Alias | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null
	if (ALIAS_INVALID_CHARS.test(trimmed)) return null
	return trimmed as Alias
}

/**
 * Type guard for Alias.
 */
export function isAlias(s: string): s is Alias {
	return coerceAlias(s) !== null
}

// === ABSOLUTE PATH ===

/**
 * Coerce a string to AbsolutePath.
 * If relative, resolves against the provided base path.
 * Normalizes the path (resolves . and ..).
 */
export function coerceAbsolutePath(s: string, basePath?: string): AbsolutePath | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null

	let resolved: string
	if (path.isAbsolute(trimmed)) {
		resolved = path.normalize(trimmed)
	} else if (basePath) {
		resolved = path.resolve(basePath, trimmed)
	} else {
		// Relative path with no base - cannot resolve
		return null
	}

	return resolved as AbsolutePath
}

/**
 * Coerce a known absolute path (no resolution needed).
 * Use when you have a path from a trusted source like process.cwd().
 */
export function coerceAbsolutePathDirect(s: string): AbsolutePath | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null
	if (!path.isAbsolute(trimmed)) return null
	return path.normalize(trimmed) as AbsolutePath
}

/**
 * Type guard for AbsolutePath.
 */
export function isAbsolutePath(s: string): s is AbsolutePath {
	return path.isAbsolute(s.trim())
}

// === NORMALIZED GIT URL ===

// Patterns for git URL normalization
const SSH_GIT_PATTERN = /^git@([^:]+):(.+?)(?:\.git)?$/
const HTTPS_GIT_PATTERN = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/

/**
 * Coerce a string to NormalizedGitUrl.
 * Converts git@host:path to https://host/path
 * Removes trailing .git
 * Always returns https:// URLs
 */
export function coerceGitUrl(s: string): NormalizedGitUrl | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null

	// Try SSH format: git@github.com:owner/repo.git
	const sshMatch = SSH_GIT_PATTERN.exec(trimmed)
	if (sshMatch) {
		const [, host, repoPath] = sshMatch
		return `https://${host}/${repoPath}` as NormalizedGitUrl
	}

	// Try HTTPS format: https://github.com/owner/repo.git
	const httpsMatch = HTTPS_GIT_PATTERN.exec(trimmed)
	if (httpsMatch) {
		const [, host, repoPath] = httpsMatch
		return `https://${host}/${repoPath}` as NormalizedGitUrl
	}

	return null
}

/**
 * Type guard for NormalizedGitUrl.
 */
export function isNormalizedGitUrl(s: string): s is NormalizedGitUrl {
	return coerceGitUrl(s) !== null
}

// === GITHUB REF ===

// Pattern for owner/repo format
const GITHUB_REF_PATTERN = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/

/**
 * Coerce a string to GithubRef.
 * Must be in owner/repo format with valid characters.
 */
export function coerceGithubRef(s: string): GithubRef | null {
	const trimmed = s.trim()
	if (trimmed.length === 0) return null

	const match = GITHUB_REF_PATTERN.exec(trimmed)
	if (!match) return null

	const [, owner, repo] = match
	if (!owner || !repo) return null

	return trimmed as GithubRef
}

/**
 * Type guard for GithubRef.
 */
export function isGithubRef(s: string): s is GithubRef {
	return coerceGithubRef(s) !== null
}

// === GIT REF (tag/branch/rev) ===

export interface RawGitRefFields {
	tag?: string
	branch?: string
	rev?: string
}

/**
 * Coerce optional tag/branch/rev fields to a GitRef.
 * Exactly one must be present and non-empty.
 * Returns null if none present, throws if multiple present.
 */
export function coerceGitRef(fields: RawGitRefFields): GitRef | null {
	const { tag, branch, rev } = fields

	const present = [
		tag ? "tag" : null,
		branch ? "branch" : null,
		rev ? "rev" : null,
	].filter(Boolean)

	if (present.length === 0) return null
	if (present.length > 1) {
		throw new Error(
			`Multiple git refs specified: ${present.join(", ")}. Only one allowed.`,
		)
	}

	if (tag) {
		const value = coerceNonEmpty(tag)
		if (!value) return null
		return { type: "tag", value }
	}
	if (branch) {
		const value = coerceNonEmpty(branch)
		if (!value) return null
		return { type: "branch", value }
	}
	if (rev) {
		const value = coerceNonEmpty(rev)
		if (!value) return null
		return { type: "rev", value }
	}

	return null
}

// === RESULT-RETURNING WRAPPERS ===

export interface CoercionError {
	field: string
	value: string
	reason: string
}

export type CoercionResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: CoercionError }

/**
 * Coerce with error context for better error messages.
 */
export function coerceNonEmptyWithError(
	s: string,
	field: string,
): CoercionResult<NonEmptyString> {
	const result = coerceNonEmpty(s)
	if (result === null) {
		return {
			error: { field, reason: "must be non-empty", value: s },
			ok: false,
		}
	}
	return { ok: true, value: result }
}

export function coerceAliasWithError(s: string, field: string): CoercionResult<Alias> {
	const result = coerceAlias(s)
	if (result === null) {
		return {
			error: {
				field,
				reason: "must be non-empty and contain no slashes, dots, or colons",
				value: s,
			},
			ok: false,
		}
	}
	return { ok: true, value: result }
}

export function coerceAbsolutePathWithError(
	s: string,
	basePath: string | undefined,
	field: string,
): CoercionResult<AbsolutePath> {
	const result = coerceAbsolutePath(s, basePath)
	if (result === null) {
		return {
			error: {
				field,
				reason: basePath
					? "must be a valid path"
					: "must be an absolute path (no base path provided)",
				value: s,
			},
			ok: false,
		}
	}
	return { ok: true, value: result }
}

export function coerceGitUrlWithError(
	s: string,
	field: string,
): CoercionResult<NormalizedGitUrl> {
	const result = coerceGitUrl(s)
	if (result === null) {
		return {
			error: {
				field,
				reason: "must be a valid git URL (git@host:path or https://host/path format)",
				value: s,
			},
			ok: false,
		}
	}
	return { ok: true, value: result }
}

export function coerceGithubRefWithError(
	s: string,
	field: string,
): CoercionResult<GithubRef> {
	const result = coerceGithubRef(s)
	if (result === null) {
		return {
			error: { field, reason: "must be in owner/repo format", value: s },
			ok: false,
		}
	}
	return { ok: true, value: result }
}
