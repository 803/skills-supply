export type GitRef = { tag: string } | { branch: string } | { rev: string }

export interface RegistryPackage {
	type: "registry"
	registry: string
	name: string
	org?: string
	version: string
	alias: string
}

export interface GithubPackage {
	type: "github"
	gh: string
	ref?: GitRef
	path?: string
	alias: string
}

export interface GitPackage {
	type: "git"
	url: string
	normalizedUrl: string
	ref?: GitRef
	path?: string
	alias: string
}

export interface LocalPackage {
	type: "local"
	absolutePath: string
	alias: string
}

export type CanonicalPackage = RegistryPackage | GithubPackage | GitPackage | LocalPackage

export interface FetchedPackage {
	canonical: CanonicalPackage
	repoPath: string
	packagePath: string
}

export interface ManifestPackageDetection {
	type: "manifest"
	rootPath: string
	manifestPath: string
}

export interface PluginPackageDetection {
	type: "plugin"
	rootPath: string
	pluginPath: string
}

export interface SubdirPackageDetection {
	type: "subdir"
	rootPath: string
	skillDirs: string[]
}

export interface SinglePackageDetection {
	type: "single"
	rootPath: string
	skillDir: string
}

export type DetectedPackage =
	| ManifestPackageDetection
	| PluginPackageDetection
	| SubdirPackageDetection
	| SinglePackageDetection

export type PackageDetectionErrorType = "invalid_package" | "io_error"

export interface PackageDetectionError {
	type: PackageDetectionErrorType
	message: string
	path: string
}

export type PackageDetectionResult =
	| { ok: true; value: DetectedPackage }
	| { ok: false; error: PackageDetectionError }

export interface Skill {
	name: string
	sourcePath: string
}

export type PackageExtractionErrorType = "invalid_skill" | "io_error"

export interface PackageExtractionError {
	type: PackageExtractionErrorType
	message: string
	path: string
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
	type: PackageFetchErrorType
	message: string
	alias: string
	source: string
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
	type: PackageResolutionErrorType
	message: string
	alias: string
	sourcePath: string
}

export type PackageResolutionResult =
	| { ok: true; value: CanonicalPackage }
	| { ok: false; error: PackageResolutionError }

export type ResolveManifestPackagesResult =
	| { ok: true; value: CanonicalPackage[] }
	| { ok: false; error: PackageResolutionError }
