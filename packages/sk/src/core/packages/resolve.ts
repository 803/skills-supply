/**
 * Package Resolution
 *
 * Converts ValidatedDependency (from manifest) to CanonicalPackage.
 * This is a PURE MAPPING - no validation needed because ValidatedDependency
 * types guarantee correctness.
 */

import type {
	Alias,
	FetchStrategy,
	NonEmptyString,
	PackageOrigin,
} from "@/core/types/branded"
import type {
	MergedManifest,
	ValidatedClaudePluginDependency,
	ValidatedDependency,
	ValidatedGitDependency,
	ValidatedGithubDependency,
	ValidatedLocalDependency,
	ValidatedRegistryDependency,
} from "@/core/manifest/types"
import type {
	CanonicalPackage,
	ClaudePluginPackage,
	GitPackage,
	GithubPackage,
	LocalPackage,
	RegistryPackage,
	ResolveManifestPackagesResult,
} from "@/core/packages/types"

const REGISTRY_NAME = "skills.supply" as NonEmptyString

/**
 * Resolve all packages from a merged manifest.
 * Pure function - no IO, no validation.
 */
export function resolveMergedPackages(
	manifest: MergedManifest,
): CanonicalPackage[] {
	const resolved: CanonicalPackage[] = []

	for (const [alias, entry] of manifest.dependencies) {
		const origin: PackageOrigin = {
			manifestPath: entry.origin.sourcePath,
			alias,
		}
		const canonical = resolveValidatedDependency(entry.dependency, origin)
		resolved.push(canonical)
	}

	return resolved
}

/**
 * Resolve a single validated dependency to a canonical package.
 * Pure function - no IO, no validation.
 */
export function resolveValidatedDependency(
	dep: ValidatedDependency,
	origin: PackageOrigin,
): CanonicalPackage {
	switch (dep.type) {
		case "registry":
			return resolveRegistryDep(dep, origin)
		case "github":
			return resolveGithubDep(dep, origin)
		case "git":
			return resolveGitDep(dep, origin)
		case "local":
			return resolveLocalDep(dep, origin)
		case "claude-plugin":
			return resolveClaudePluginDep(dep, origin)
	}
}

/**
 * Determine fetch strategy based on dependency type.
 */
function determineFetchStrategy(dep: ValidatedDependency): FetchStrategy {
	if (dep.type === "local") {
		return { mode: "symlink" }
	}
	// For remote packages, use sparse clone if a path is specified
	const hasPath = "path" in dep && dep.path !== undefined
	return { mode: "clone", sparse: hasPath }
}

function resolveRegistryDep(
	dep: ValidatedRegistryDependency,
	origin: PackageOrigin,
): RegistryPackage {
	return {
		type: "registry",
		origin,
		fetchStrategy: { mode: "clone", sparse: false },
		registry: REGISTRY_NAME,
		name: dep.name,
		org: dep.org,
		version: dep.version,
	}
}

function resolveGithubDep(
	dep: ValidatedGithubDependency,
	origin: PackageOrigin,
): GithubPackage {
	return {
		type: "github",
		origin,
		fetchStrategy: determineFetchStrategy(dep),
		gh: dep.gh,
		ref: dep.ref,
		path: dep.path,
	}
}

function resolveGitDep(
	dep: ValidatedGitDependency,
	origin: PackageOrigin,
): GitPackage {
	return {
		type: "git",
		origin,
		fetchStrategy: determineFetchStrategy(dep),
		url: dep.url,
		ref: dep.ref,
		path: dep.path,
	}
}

function resolveLocalDep(
	dep: ValidatedLocalDependency,
	origin: PackageOrigin,
): LocalPackage {
	return {
		type: "local",
		origin,
		fetchStrategy: { mode: "symlink" },
		absolutePath: dep.path,
	}
}

function resolveClaudePluginDep(
	dep: ValidatedClaudePluginDependency,
	origin: PackageOrigin,
): ClaudePluginPackage {
	return {
		type: "claude-plugin",
		origin,
		fetchStrategy: { mode: "clone", sparse: false },
		plugin: dep.plugin,
		marketplace: dep.marketplace,
	}
}
