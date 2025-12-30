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

export type PackageDeclaration =
	| RegistryPackageDeclaration
	| GithubPackageDeclaration
	| GitPackageDeclaration
	| LocalPackageDeclaration

export interface Manifest {
	agents: Record<string, boolean>
	packages: Record<string, PackageDeclaration>
	sourcePath: string
}

export type ManifestParseErrorType =
	| "invalid_toml"
	| "invalid_root"
	| "invalid_agents"
	| "invalid_packages"
	| "invalid_package"

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
