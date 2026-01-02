/**
 * Branded Types for SK
 *
 * These types use TypeScript's structural typing with brand symbols to create
 * nominal types. Once a value has been coerced to a branded type, its validity
 * is guaranteed by the type system - no runtime checks needed in core logic.
 *
 * Only coercion functions in ./coerce.ts should create branded values.
 */

// === BRAND SYMBOLS ===

declare const NonEmptyStringBrand: unique symbol
declare const AliasBrand: unique symbol
declare const AbsolutePathBrand: unique symbol
declare const GitUrlBrand: unique symbol
declare const GithubRefBrand: unique symbol

// === BRANDED TYPES ===

/**
 * A non-empty, trimmed string.
 * Guarantees: length > 0, no leading/trailing whitespace
 */
export type NonEmptyString = string & { readonly [NonEmptyStringBrand]: true }

/**
 * A valid package alias.
 * Guarantees: non-empty, no slashes, no dots, trimmed
 */
export type Alias = string & { readonly [AliasBrand]: true }

/**
 * An absolute filesystem path.
 * Guarantees: starts with /, normalized (no . or ..)
 */
export type AbsolutePath = string & { readonly [AbsolutePathBrand]: true }

/**
 * A validated git URL.
 * Guarantees: ssh or http(s) format, no trailing .git, trimmed
 */
export type GitUrl = string & { readonly [GitUrlBrand]: true }

/**
 * A GitHub repository reference in owner/repo format.
 * Guarantees: exactly one slash, non-empty owner and repo, trimmed
 */
export type GithubRef = string & { readonly [GithubRefBrand]: true }

// === GIT REF (discriminated union, not branded) ===

/**
 * A git reference - exactly one of tag, branch, or rev.
 * Using discriminated union instead of optional fields ensures
 * consumers handle all cases and can't have multiple refs.
 */
export type GitRef =
	| { readonly type: "tag"; readonly value: NonEmptyString }
	| { readonly type: "branch"; readonly value: NonEmptyString }
	| { readonly type: "rev"; readonly value: NonEmptyString }

// === ORIGIN TRACKING ===

/**
 * How a manifest was discovered during the search process.
 */
export type ManifestDiscoveredAt = "cwd" | "parent" | "home" | "sk-global"

/**
 * Origin information for a manifest.
 * Tracks where the manifest came from for error messages.
 */
export interface ManifestOrigin {
	readonly sourcePath: AbsolutePath
	readonly discoveredAt: ManifestDiscoveredAt
}

/**
 * Origin information for a package.
 * Tracks which manifest declared this package for error messages.
 */
export interface PackageOrigin {
	readonly manifestPath: AbsolutePath
	readonly alias: Alias
}

// === FETCH STRATEGY ===

/**
 * How a package should be fetched/installed.
 * Determined at resolve time, not install time.
 */
export type FetchStrategy =
	| { readonly mode: "clone"; readonly sparse: boolean }
	| { readonly mode: "symlink" }

// === AGENT ID ===

/**
 * Known agent identifiers.
 */
export type AgentId = "claude-code" | "codex" | "opencode" | "factory"

// === TYPE UTILITIES ===

/**
 * Unwrap a branded type to its underlying string.
 * Use sparingly - prefer keeping branded types through the pipeline.
 */
export function unwrap<T extends string>(branded: T): string {
	return branded
}
