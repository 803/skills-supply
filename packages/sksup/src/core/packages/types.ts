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
