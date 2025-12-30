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

export interface PackageMetadata {
	name: string
	version: string
	description?: string
	license?: string
	org?: string
}

export interface ManifestExportsAutoDiscover {
	skills: string | false
}

export interface ManifestExports {
	autoDiscover: ManifestExportsAutoDiscover
}

export interface Manifest {
	package?: PackageMetadata
	agents: Record<string, boolean>
	dependencies: Record<string, DependencyDeclaration>
	exports?: ManifestExports
	sourcePath: string
}

export type ManifestParseErrorType = "invalid_toml" | "invalid_manifest"

export interface ManifestParseError {
	type: ManifestParseErrorType
	message: string
	sourcePath: string
	key?: string
}

export type ManifestParseResult =
	| { ok: true; value: Manifest }
	| { ok: false; error: ManifestParseError }

export type ManifestDiscoveryErrorType = "invalid_start" | "io_error"

export interface ManifestDiscoveryError {
	type: ManifestDiscoveryErrorType
	message: string
	path: string
}

export type ManifestDiscoveryResult =
	| { ok: true; value: string[] }
	| { ok: false; error: ManifestDiscoveryError }

export interface ManifestDependencyEntry {
	declaration: DependencyDeclaration
	sourcePath: string
}

export interface MergedManifest {
	agents: Record<string, boolean>
	dependencies: Record<string, ManifestDependencyEntry>
}

export type ManifestMergeErrorType = "alias_conflict" | "invalid_dependency"

export interface ManifestMergeError {
	type: ManifestMergeErrorType
	message: string
	alias: string
	sourcePath: string
}

export type ManifestMergeResult =
	| { ok: true; value: MergedManifest }
	| { ok: false; error: ManifestMergeError }
