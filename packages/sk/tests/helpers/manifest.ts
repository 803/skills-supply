/**
 * Manifest test helpers
 *
 * Builder functions for creating test manifests with sensible defaults.
 */

import type {
	DependencyDeclaration,
	ManifestExports,
	PackageMetadata,
	RawManifest,
} from "@/src/core/manifest/types"

/**
 * Partial overrides for building a RawManifest.
 */
export interface RawManifestOverrides {
	package?: Partial<PackageMetadata>
	agents?: Record<string, boolean>
	dependencies?: Record<string, DependencyDeclaration>
	exports?: ManifestExports
	sourcePath?: string
}

/**
 * Build a valid RawManifest with sensible defaults.
 * All fields can be overridden for specific test scenarios.
 *
 * @example
 * // Minimal manifest
 * const manifest = buildRawManifest()
 *
 * // With dependencies
 * const manifest = buildRawManifest({
 *   dependencies: { 'my-pkg': 'my-org/my-pkg@1.0.0' }
 * })
 *
 * // With custom package metadata
 * const manifest = buildRawManifest({
 *   package: { name: 'custom-name', version: '2.0.0' }
 * })
 */
export function buildRawManifest(overrides: RawManifestOverrides = {}): RawManifest {
	const defaultPackage: PackageMetadata = {
		name: "test-pkg",
		version: "1.0.0",
	}

	return {
		agents: overrides.agents ?? { "claude-code": true },
		dependencies: overrides.dependencies ?? {},
		exports: overrides.exports,
		package: overrides.package
			? { ...defaultPackage, ...overrides.package }
			: defaultPackage,
		sourcePath: overrides.sourcePath ?? "/test/package.toml",
	}
}

/**
 * Build a RawManifest with GitHub dependencies.
 *
 * @example
 * const manifest = buildManifestWithGithubDeps({
 *   'superpowers': 'superpowers-marketplace/superpowers',
 *   'elements': { gh: 'superpowers-marketplace/elements-of-style', tag: 'v1.0.0' }
 * })
 */
export function buildManifestWithGithubDeps(
	deps: Record<
		string,
		string | { gh: string; tag?: string; branch?: string; rev?: string }
	>,
	overrides: Omit<RawManifestOverrides, "dependencies"> = {},
): RawManifest {
	const dependencies: Record<string, DependencyDeclaration> = {}

	for (const [alias, spec] of Object.entries(deps)) {
		if (typeof spec === "string") {
			dependencies[alias] = { gh: spec }
		} else {
			dependencies[alias] = spec
		}
	}

	return buildRawManifest({ ...overrides, dependencies })
}

/**
 * Build a RawManifest with local dependencies.
 *
 * @example
 * const manifest = buildManifestWithLocalDeps({
 *   'my-local': '/path/to/local/package'
 * })
 */
export function buildManifestWithLocalDeps(
	deps: Record<string, string>,
	overrides: Omit<RawManifestOverrides, "dependencies"> = {},
): RawManifest {
	const dependencies: Record<string, DependencyDeclaration> = {}

	for (const [alias, path] of Object.entries(deps)) {
		dependencies[alias] = { path }
	}

	return buildRawManifest({ ...overrides, dependencies })
}

/**
 * Build a RawManifest configured for multiple agents.
 *
 * @example
 * const manifest = buildMultiAgentManifest(['claude-code', 'codex'])
 */
export function buildMultiAgentManifest(
	agents: string[],
	overrides: Omit<RawManifestOverrides, "agents"> = {},
): RawManifest {
	const agentsRecord: Record<string, boolean> = {}
	for (const agent of agents) {
		agentsRecord[agent] = true
	}

	return buildRawManifest({ ...overrides, agents: agentsRecord })
}
