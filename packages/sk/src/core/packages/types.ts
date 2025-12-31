import type {
	AbsolutePath,
	Alias,
	FetchStrategy,
	GithubRef,
	GitRef,
	NonEmptyString,
	NormalizedGitUrl,
	PackageOrigin,
} from "@/core/types/branded"

// =============================================================================
// PACKAGE ORIGIN
// =============================================================================

// Re-export from branded types for convenience
export type { FetchStrategy, GitRef, PackageOrigin } from "@/core/types/branded"

// =============================================================================
// CANONICAL PACKAGE TYPES
// =============================================================================

/**
 * Base fields present on all canonical packages.
 */
interface CanonicalPackageBase {
	readonly origin: PackageOrigin
	readonly fetchStrategy: FetchStrategy
}

export interface RegistryPackage extends CanonicalPackageBase {
	readonly type: "registry"
	readonly registry: NonEmptyString
	readonly name: NonEmptyString
	readonly org?: NonEmptyString
	readonly version: NonEmptyString
}

export interface GithubPackage extends CanonicalPackageBase {
	readonly type: "github"
	readonly gh: GithubRef
	readonly ref?: GitRef
	readonly path?: NonEmptyString
}

export interface GitPackage extends CanonicalPackageBase {
	readonly type: "git"
	readonly url: NormalizedGitUrl
	readonly ref?: GitRef
	readonly path?: NonEmptyString
}

export interface LocalPackage extends CanonicalPackageBase {
	readonly type: "local"
	readonly absolutePath: AbsolutePath
}

export interface ClaudePluginPackage extends CanonicalPackageBase {
	readonly type: "claude-plugin"
	readonly plugin: NonEmptyString
	readonly marketplace: NormalizedGitUrl
}

export type CanonicalPackage =
	| RegistryPackage
	| GithubPackage
	| GitPackage
	| LocalPackage
	| ClaudePluginPackage

// =============================================================================
// FETCHED PACKAGE
// =============================================================================

export interface FetchedPackage {
	readonly canonical: CanonicalPackage
	readonly repoPath: AbsolutePath
	readonly packagePath: AbsolutePath
}

// =============================================================================
// DETECTED PACKAGE (uniform structure)
// =============================================================================

/**
 * Detection method metadata.
 */
export type DetectionMethod = "manifest" | "plugin" | "subdir" | "single"

/**
 * Detected package - uniform structure regardless of detection method.
 */
export interface DetectedPackage {
	readonly canonical: CanonicalPackage
	readonly packagePath: AbsolutePath
	readonly detection: {
		readonly method: DetectionMethod
		readonly manifestPath?: AbsolutePath // If detected via manifest
	}
	readonly skillPaths: readonly AbsolutePath[] // Always an array
}

// =============================================================================
// LEGACY DETECTION TYPES (for gradual migration)
// =============================================================================

/**
 * @deprecated Use DetectedPackage instead
 */
export interface ManifestPackageDetection {
	type: "manifest"
	rootPath: string
	manifestPath: string
}

/**
 * @deprecated Use DetectedPackage instead
 */
export interface PluginPackageDetection {
	type: "plugin"
	rootPath: string
	pluginPath: string
}

/**
 * @deprecated Use DetectedPackage instead
 */
export interface SubdirPackageDetection {
	type: "subdir"
	rootPath: string
	skillDirs: string[]
}

/**
 * @deprecated Use DetectedPackage instead
 */
export interface SinglePackageDetection {
	type: "single"
	rootPath: string
	skillDir: string
}

/**
 * @deprecated Use DetectedPackage instead
 */
export type LegacyDetectedPackage =
	| ManifestPackageDetection
	| PluginPackageDetection
	| SubdirPackageDetection
	| SinglePackageDetection

// =============================================================================
// SKILL
// =============================================================================

export interface Skill {
	readonly name: NonEmptyString
	readonly sourcePath: AbsolutePath
	readonly origin: PackageOrigin // Inherited from parent package
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export type PackageDetectionErrorType = "invalid_package" | "io_error"

export interface PackageDetectionError {
	readonly type: PackageDetectionErrorType
	readonly message: string
	readonly path: AbsolutePath
}

export type PackageDetectionResult =
	| { ok: true; value: DetectedPackage }
	| { ok: false; error: PackageDetectionError }

export type PackageExtractionErrorType = "invalid_skill" | "io_error"

export interface PackageExtractionError {
	readonly type: PackageExtractionErrorType
	readonly message: string
	readonly path: AbsolutePath
	readonly origin?: PackageOrigin
}

export type PackageExtractionResult =
	| { ok: true; value: Skill[] }
	| { ok: false; error: PackageExtractionError }

export type PackageFetchErrorType =
	| "invalid_source"
	| "invalid_ref"
	| "invalid_repo"
	| "io_error"
	| "git_error"

export interface PackageFetchError {
	readonly type: PackageFetchErrorType
	readonly message: string
	readonly origin: PackageOrigin
	readonly source: string
}

export type PackageFetchResult =
	| { ok: true; value: FetchedPackage }
	| { ok: false; error: PackageFetchError }

export type PackageResolutionErrorType =
	| "invalid_alias"
	| "invalid_registry_name"
	| "invalid_source_path"
	| "invalid_git_url"
	| "invalid_value"

export interface PackageResolutionError {
	readonly type: PackageResolutionErrorType
	readonly message: string
	readonly origin: PackageOrigin
}

export type PackageResolutionResult =
	| { ok: true; value: CanonicalPackage }
	| { ok: false; error: PackageResolutionError }

export type ResolveManifestPackagesResult =
	| { ok: true; value: CanonicalPackage[] }
	| { ok: false; error: PackageResolutionError }
