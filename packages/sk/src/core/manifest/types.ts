import type {
	AbsolutePath,
	AgentId,
	Alias,
	GithubRef,
	GitRef,
	ManifestOrigin,
	NonEmptyString,
	NormalizedGitUrl,
} from "@/src/core/types/branded"

// =============================================================================
// RAW DECLARATION TYPES (from TOML, before validation)
// These represent what we parse from the file, before coercion.
// =============================================================================

export type RegistryPackageDeclaration = string

export interface GithubPackageDeclaration {
	gh: string
	tag?: string
	branch?: string
	rev?: string
	path?: string
}

export interface GitPackageDeclaration {
	git: string
	tag?: string
	branch?: string
	rev?: string
	path?: string
}

export interface LocalPackageDeclaration {
	path: string
}

export interface ClaudePluginDeclaration {
	type: "claude-plugin"
	plugin: string
	marketplace: string
}

export type DependencyDeclaration =
	| RegistryPackageDeclaration
	| GithubPackageDeclaration
	| GitPackageDeclaration
	| LocalPackageDeclaration
	| ClaudePluginDeclaration

export interface DependencyDraft {
	alias: string
	declaration: DependencyDeclaration
}

// =============================================================================
// VALIDATED DEPENDENCY TYPES (after coercion at parse boundary)
// These use branded types - validity is guaranteed by the type system.
// =============================================================================

export interface ValidatedRegistryDependency {
	readonly type: "registry"
	readonly name: NonEmptyString
	readonly org?: NonEmptyString
	readonly version: NonEmptyString
}

export interface ValidatedGithubDependency {
	readonly type: "github"
	readonly gh: GithubRef
	readonly ref?: GitRef
	readonly path?: NonEmptyString
}

export interface ValidatedGitDependency {
	readonly type: "git"
	readonly url: NormalizedGitUrl
	readonly ref?: GitRef
	readonly path?: NonEmptyString
}

export interface ValidatedLocalDependency {
	readonly type: "local"
	readonly path: AbsolutePath // Resolved at parse time!
}

export interface ValidatedClaudePluginDependency {
	readonly type: "claude-plugin"
	readonly plugin: NonEmptyString
	readonly marketplace: NormalizedGitUrl | GithubRef
}

export type ValidatedDependency =
	| ValidatedRegistryDependency
	| ValidatedGithubDependency
	| ValidatedGitDependency
	| ValidatedLocalDependency
	| ValidatedClaudePluginDependency

// =============================================================================
// PACKAGE METADATA
// =============================================================================

export interface PackageMetadata {
	name: string
	version: string
	description?: string
	license?: string
	org?: string
}

export interface ValidatedPackageMetadata {
	readonly name: NonEmptyString
	readonly version: NonEmptyString
	readonly description?: NonEmptyString
	readonly license?: NonEmptyString
	readonly org?: NonEmptyString
}

// =============================================================================
// MANIFEST EXPORTS
// =============================================================================

export interface ManifestExportsAutoDiscover {
	skills: string | false
}

export interface ManifestExports {
	autoDiscover: ManifestExportsAutoDiscover
}

export interface ValidatedManifestExports {
	readonly autoDiscover: {
		readonly skills: NonEmptyString | false
	}
}

// =============================================================================
// MANIFEST TYPES
// =============================================================================

/**
 * Raw manifest - as parsed from TOML, before validation.
 * Used internally during parsing.
 */
export interface RawManifest {
	package?: PackageMetadata
	agents: Record<string, boolean>
	dependencies: Record<string, DependencyDeclaration>
	exports?: ManifestExports
	sourcePath: string
}

/**
 * Validated manifest - all fields coerced to branded types.
 * This is what consumers should use.
 */
export interface Manifest {
	readonly package?: ValidatedPackageMetadata
	readonly agents: ReadonlyMap<AgentId, boolean>
	readonly dependencies: ReadonlyMap<Alias, ValidatedDependency>
	readonly exports?: ValidatedManifestExports
	readonly origin: ManifestOrigin
}

/**
 * Legacy manifest type - for gradual migration.
 * @deprecated Use Manifest instead
 */
export interface LegacyManifest {
	package?: PackageMetadata
	agents: Record<string, boolean>
	dependencies: Record<string, DependencyDeclaration>
	exports?: ManifestExports
	sourcePath: string
}

// =============================================================================
// PARSE ERRORS AND RESULTS
// =============================================================================

export type ManifestParseErrorType =
	| "invalid_toml"
	| "invalid_manifest"
	| "invalid_dependency"
	| "coercion_failed"

export interface ManifestParseError {
	readonly type: ManifestParseErrorType
	readonly message: string
	readonly sourcePath: AbsolutePath
	readonly key?: string
	readonly field?: string
}

/**
 * Result of parsing a manifest file.
 * On success, returns a fully validated Manifest.
 */
export type ManifestParseResult =
	| { ok: true; value: Manifest }
	| { ok: false; error: ManifestParseError }

/**
 * Legacy parse result for gradual migration.
 * @deprecated Use ManifestParseResult instead
 */
export type LegacyManifestParseResult =
	| { ok: true; value: LegacyManifest }
	| { ok: false; error: ManifestParseError }

// =============================================================================
// DISCOVERY ERRORS AND RESULTS
// =============================================================================

export type ManifestDiscoveryErrorType = "invalid_start" | "io_error"

export interface ManifestDiscoveryError {
	readonly type: ManifestDiscoveryErrorType
	readonly message: string
	readonly path: AbsolutePath
}

/**
 * Result of discovering manifest root directories.
 * Returns the absolute path to the directory containing agents.toml, or null if not found.
 */
export type ManifestDiscoveryResult =
	| { ok: true; value: AbsolutePath | null }
	| { ok: false; error: ManifestDiscoveryError }
