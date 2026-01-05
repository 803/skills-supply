/**
 * Package Resolution
 *
 * Converts ValidatedDeclaration (from manifest) to CanonicalPackage.
 * This is a PURE MAPPING - no validation needed because ValidatedDeclaration
 * types guarantee correctness.
 */

import type { NonEmptyString, ValidatedDeclaration } from "@skills-supply/core"
import type { Manifest } from "@/manifest/types"
import type {
	CanonicalPackage,
	ClaudePluginPackage,
	GithubPackage,
	GitPackage,
	LocalPackage,
	RegistryPackage,
} from "@/packages/types"
import type { FetchStrategy, PackageOrigin } from "@/types/context"

const REGISTRY_NAME = "skills.supply" as NonEmptyString

/**
 * Resolve all packages from a manifest.
 * Pure function - no IO, no validation.
 */
export function resolveManifestPackages(manifest: Manifest): CanonicalPackage[] {
	const resolved: CanonicalPackage[] = []

	for (const [alias, dependency] of manifest.dependencies) {
		const origin: PackageOrigin = {
			alias,
			manifestPath: manifest.origin.sourcePath,
		}
		const canonical = resolveValidatedDependency(dependency, origin)
		resolved.push(canonical)
	}

	return resolved
}

/**
 * Resolve a single validated dependency to a canonical package.
 * Pure function - no IO, no validation.
 */
export function resolveValidatedDependency(
	dep: ValidatedDeclaration,
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
function determineFetchStrategy(dep: ValidatedDeclaration): FetchStrategy {
	if (dep.type === "local") {
		return { mode: "symlink" }
	}
	// For remote packages, use sparse clone if a path is specified
	const hasPath = "path" in dep && dep.path !== undefined
	return { mode: "clone", sparse: hasPath }
}

function resolveRegistryDep(
	dep: Extract<ValidatedDeclaration, { type: "registry" }>,
	origin: PackageOrigin,
): RegistryPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		name: dep.name,
		org: dep.org,
		origin,
		registry: REGISTRY_NAME,
		type: "registry",
		version: dep.version,
	}
}

function resolveGithubDep(
	dep: Extract<ValidatedDeclaration, { type: "github" }>,
	origin: PackageOrigin,
): GithubPackage {
	return {
		fetchStrategy: determineFetchStrategy(dep),
		gh: dep.gh,
		origin,
		path: dep.path,
		ref: dep.ref,
		type: "github",
	}
}

function resolveGitDep(
	dep: Extract<ValidatedDeclaration, { type: "git" }>,
	origin: PackageOrigin,
): GitPackage {
	return {
		fetchStrategy: determineFetchStrategy(dep),
		origin,
		path: dep.path,
		ref: dep.ref,
		type: "git",
		url: dep.url,
	}
}

function resolveLocalDep(
	dep: Extract<ValidatedDeclaration, { type: "local" }>,
	origin: PackageOrigin,
): LocalPackage {
	return {
		absolutePath: dep.path,
		fetchStrategy: { mode: "symlink" },
		origin,
		type: "local",
	}
}

function resolveClaudePluginDep(
	dep: Extract<ValidatedDeclaration, { type: "claude-plugin" }>,
	origin: PackageOrigin,
): ClaudePluginPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		marketplace: dep.marketplace,
		origin,
		plugin: dep.plugin,
		type: "claude-plugin",
	}
}
