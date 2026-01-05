import type {
	AbsolutePath,
	DetectedStructure,
	GithubRef,
	GitRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@skills-supply/core"
import type { FetchStrategy, PackageOrigin } from "@/types/context"
import type {
	ConflictError,
	IoError,
	NotFoundError,
	ValidationError,
} from "@/types/errors"

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
	readonly url: GitUrl
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
	readonly marketplace: GitUrl | GithubRef | AbsolutePath | RemoteMarketplaceUrl
}

export type CanonicalPackage =
	| RegistryPackage
	| GithubPackage
	| GitPackage
	| LocalPackage
	| ClaudePluginPackage

export interface FetchedPackage {
	readonly canonical: CanonicalPackage
	readonly repoPath: AbsolutePath
	readonly packagePath: AbsolutePath
}

export interface DetectedPackage {
	readonly canonical: CanonicalPackage
	readonly packagePath: AbsolutePath
	readonly detection: DetectedStructure
}

export interface Skill {
	readonly name: NonEmptyString
	readonly sourcePath: AbsolutePath
	readonly origin: PackageOrigin
}

export type PackageExtractionError =
	| (ValidationError & { origin: PackageOrigin; path: AbsolutePath })
	| (IoError & { origin: PackageOrigin; path: AbsolutePath })
	| (NotFoundError & { origin: PackageOrigin; path: AbsolutePath })

export type PackageExtractionResult =
	| { ok: true; value: Skill[] }
	| { ok: false; error: PackageExtractionError }

export type PackageFetchError =
	| (ValidationError & { origin: PackageOrigin; spec: string })
	| (IoError & { origin: PackageOrigin; spec: string })
	| (ConflictError & { origin: PackageOrigin; spec: string })
	| (NotFoundError & { origin: PackageOrigin; spec: string })

export type PackageFetchResult =
	| { ok: true; value: FetchedPackage }
	| { ok: false; error: PackageFetchError }

export type PackageResolutionError = ValidationError & { origin: PackageOrigin }

export type PackageResolutionResult =
	| { ok: true; value: CanonicalPackage }
	| { ok: false; error: PackageResolutionError }

export type ResolveManifestPackagesResult =
	| { ok: true; value: CanonicalPackage[] }
	| { ok: false; error: PackageResolutionError }
