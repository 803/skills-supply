import { readFile, writeFile } from "node:fs/promises"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	CoreError,
	Result,
	ValidatedDeclaration,
} from "@skills-supply/core"
import { parseManifest } from "@/manifest/parse"
import type { Manifest } from "@/manifest/types"
import { type SerializeOptions, serializeManifest } from "@/manifest/write"
import type { ManifestDiscoveredAt } from "@/types/context"

export interface ManifestLoadResult {
	created: boolean
	manifest: Manifest
	manifestPath: AbsolutePath
}

/**
 * Load a manifest from a specific path.
 */
export async function loadManifest(
	manifestPath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): Promise<Result<ManifestLoadResult, CoreError>> {
	let contents: string
	try {
		contents = await readFile(manifestPath, "utf8")
	} catch (error) {
		if (isNotFound(error)) {
			return {
				error: {
					message: `Manifest not found: ${manifestPath}`,
					path: manifestPath,
					target: "manifest",
					type: "not_found",
				},
				ok: false,
			}
		}
		return {
			error: {
				message: `Unable to read ${manifestPath}.`,
				operation: "readFile",
				path: manifestPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const parsed = parseManifest(contents, manifestPath, discoveredAt)
	if (!parsed.ok) {
		return parsed
	}

	return { ok: true, value: { created: false, manifest: parsed.value, manifestPath } }
}

/**
 * Create an empty manifest with proper typed structures.
 */
export function createEmptyManifest(
	sourcePath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): Manifest {
	return {
		agents: new Map<AgentId, boolean>(),
		dependencies: new Map<Alias, ValidatedDeclaration>(),
		origin: { discoveredAt, sourcePath },
	}
}

/**
 * Save a manifest to disk.
 */
export async function saveManifest(
	manifest: Manifest,
	manifestPath: AbsolutePath,
	options?: SerializeOptions,
): Promise<Result<void, CoreError>> {
	const serialized = serializeManifest(manifest, options)
	try {
		await writeFile(manifestPath, serialized, "utf8")
	} catch (error) {
		return {
			error: {
				message: `Unable to write ${manifestPath}.`,
				operation: "writeFile",
				path: manifestPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
	return { ok: true, value: undefined }
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
