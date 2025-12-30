import type {
	Manifest,
	ManifestMergeError,
	ManifestMergeResult,
	ManifestPackageEntry,
	PackageDeclaration,
} from "@/core/manifest/types"
import { resolvePackageDeclaration } from "@/core/packages/resolve"
import type { CanonicalPackage } from "@/core/packages/types"

type DedupeKeyResult =
	| { ok: true; value: string }
	| { ok: false; error: ManifestMergeError }

export function mergeManifests(manifests: Manifest[]): ManifestMergeResult {
	const mergedAgents: Record<string, boolean> = {}
	const mergedPackages: Record<string, ManifestPackageEntry> = {}
	const aliasToDedupe = new Map<string, string>()
	const aliasSources = new Map<string, string>()
	const dedupeToAlias = new Map<string, string>()

	for (const manifest of manifests) {
		for (const [agent, enabled] of Object.entries(manifest.agents)) {
			if (mergedAgents[agent] === undefined) {
				mergedAgents[agent] = enabled
			}
		}

		for (const [alias, declaration] of Object.entries(manifest.packages)) {
			const dedupeResult = buildDedupeKey(alias, declaration, manifest.sourcePath)
			if (!dedupeResult.ok) {
				return dedupeResult
			}

			const dedupeKey = dedupeResult.value
			const existingDedupe = aliasToDedupe.get(alias)
			if (existingDedupe) {
				if (existingDedupe !== dedupeKey) {
					const existingSource = aliasSources.get(alias) ?? "unknown"
					return failure(
						"alias_conflict",
						`Alias "${alias}" refers to different packages (first: ${existingSource}, next: ${manifest.sourcePath}).`,
						alias,
						manifest.sourcePath,
					)
				}

				continue
			}

			if (dedupeToAlias.has(dedupeKey)) {
				continue
			}

			aliasToDedupe.set(alias, dedupeKey)
			aliasSources.set(alias, manifest.sourcePath)
			dedupeToAlias.set(dedupeKey, alias)
			mergedPackages[alias] = {
				declaration,
				sourcePath: manifest.sourcePath,
			}
		}
	}

	return {
		ok: true,
		value: {
			agents: mergedAgents,
			packages: mergedPackages,
		},
	}
}

function buildDedupeKey(
	alias: string,
	declaration: PackageDeclaration,
	sourcePath: string,
): DedupeKeyResult {
	const resolved = resolvePackageDeclaration(alias, declaration, sourcePath)
	if (!resolved.ok) {
		return failure("invalid_package", resolved.error.message, alias, sourcePath)
	}

	return { ok: true, value: dedupeKeyFromCanonical(resolved.value) }
}

function dedupeKeyFromCanonical(canonical: CanonicalPackage): string {
	switch (canonical.type) {
		case "registry": {
			const orgPart = canonical.org ?? ""
			return ["registry", canonical.registry, orgPart, canonical.name].join("|")
		}
		case "github":
			return ["github", canonical.gh, canonical.path ?? ""].join("|")
		case "git":
			return ["git", canonical.normalizedUrl, canonical.path ?? ""].join("|")
		case "local":
			return ["local", canonical.absolutePath].join("|")
	}
}

function failure(
	type: ManifestMergeError["type"],
	message: string,
	alias: string,
	sourcePath: string,
): { ok: false; error: ManifestMergeError } {
	return {
		error: {
			alias,
			message,
			sourcePath,
			type,
		},
		ok: false,
	}
}
