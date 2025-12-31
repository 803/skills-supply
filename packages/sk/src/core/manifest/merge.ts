import type {
	Manifest,
	ManifestDependencyEntry,
	ManifestMergeError,
	ManifestMergeResult,
	MergedManifest,
	ValidatedDependency,
} from "@/core/manifest/types"
import type { AgentId, Alias, ManifestOrigin } from "@/core/types/branded"

/**
 * Merge multiple manifests into a single merged manifest.
 *
 * - Agents: first occurrence wins (earlier manifests take precedence)
 * - Dependencies: deduplicated by canonical form
 *   - Same alias, different package → error
 *   - Same package, different alias → warning, first alias wins
 */
export function mergeManifests(manifests: Manifest[]): ManifestMergeResult {
	const mergedAgents = new Map<AgentId, boolean>()
	const mergedDependencies = new Map<Alias, ManifestDependencyEntry>()
	const warnings: string[] = []

	// Track alias → dedupe key mapping
	const aliasToDedupe = new Map<Alias, string>()
	const aliasOrigins = new Map<Alias, ManifestOrigin>()

	// Track dedupe key → first alias (for warning about duplicates)
	const dedupeToAlias = new Map<string, Alias>()
	const warnedAliases = new Set<Alias>()

	for (const manifest of manifests) {
		// Merge agents (first occurrence wins)
		for (const [agentId, enabled] of manifest.agents) {
			if (!mergedAgents.has(agentId)) {
				mergedAgents.set(agentId, enabled)
			}
		}

		// Merge dependencies with deduplication
		for (const [alias, dependency] of manifest.dependencies) {
			const dedupeKey = buildDedupeKey(dependency)
			const existingDedupe = aliasToDedupe.get(alias)

			if (existingDedupe) {
				// This alias was seen before
				if (existingDedupe !== dedupeKey) {
					// Same alias, different package → error
					const existingOrigin = aliasOrigins.get(alias)
					return failure(
						"alias_conflict",
						`Alias "${alias}" refers to different dependencies (first: ${existingOrigin?.sourcePath ?? "unknown"}, next: ${manifest.origin.sourcePath}).`,
						alias,
						manifest.origin,
					)
				}
				// Same alias, same package → skip (already added)
				continue
			}

			// Check if this package was seen under a different alias
			const existingAlias = dedupeToAlias.get(dedupeKey)
			if (existingAlias && existingAlias !== alias && !warnedAliases.has(alias)) {
				const existingOrigin = aliasOrigins.get(existingAlias)
				warnings.push(
					`Dependency alias "${alias}" in ${manifest.origin.sourcePath} resolves to the same package as "${existingAlias}" in ${existingOrigin?.sourcePath ?? "unknown"}; using "${existingAlias}".`,
				)
				warnedAliases.add(alias)
				continue
			}

			// New dependency - add it
			aliasToDedupe.set(alias, dedupeKey)
			aliasOrigins.set(alias, manifest.origin)
			dedupeToAlias.set(dedupeKey, alias)
			mergedDependencies.set(alias, {
				dependency,
				origin: manifest.origin,
			})
		}
	}

	return {
		ok: true,
		value: {
			agents: mergedAgents,
			dependencies: mergedDependencies,
			warnings,
		},
	}
}

/**
 * Build a dedupe key from a validated dependency.
 * Packages that resolve to the same key are considered identical.
 */
function buildDedupeKey(dep: ValidatedDependency): string {
	switch (dep.type) {
		case "registry": {
			const orgPart = dep.org ?? ""
			return ["registry", orgPart, dep.name].join("|")
		}
		case "github":
			return ["github", dep.gh, dep.path ?? ""].join("|")
		case "git":
			return ["git", dep.url, dep.path ?? ""].join("|")
		case "local":
			return ["local", dep.path].join("|")
		case "claude-plugin":
			return ["claude-plugin", dep.marketplace, dep.plugin].join("|")
	}
}

function failure(
	type: ManifestMergeError["type"],
	message: string,
	alias: Alias,
	origin: ManifestOrigin,
): { ok: false; error: ManifestMergeError } {
	return {
		error: {
			alias,
			message,
			origin,
			type,
		},
		ok: false,
	}
}
