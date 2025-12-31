import { readFile, writeFile } from "node:fs/promises"
import { parseManifest } from "@/src/core/manifest/parse"
import type { Manifest, ValidatedDependency } from "@/src/core/manifest/types"
import { type SerializeOptions, serializeManifest } from "@/src/core/manifest/write"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	ManifestDiscoveredAt,
} from "@/src/core/types/branded"

export interface ManifestLoadResult {
	created: boolean
	manifest: Manifest
	manifestPath: AbsolutePath
}

export class ManifestNotFoundError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ManifestNotFoundError"
	}
}

/**
 * Load a manifest from a specific path.
 */
export async function loadManifest(
	manifestPath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): Promise<ManifestLoadResult> {
	try {
		const contents = await readFile(manifestPath, "utf8")
		const parsed = parseManifest(contents, manifestPath, discoveredAt)
		if (!parsed.ok) {
			throw new Error(parsed.error.message)
		}
		return { created: false, manifest: parsed.value, manifestPath }
	} catch (error) {
		if (isNotFound(error)) {
			throw new ManifestNotFoundError(`Manifest not found: ${manifestPath}`)
		}
		throw error
	}
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
		dependencies: new Map<Alias, ValidatedDependency>(),
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
): Promise<void> {
	const serialized = serializeManifest(manifest, options)
	await writeFile(manifestPath, serialized, "utf8")
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

export function isManifestNotFoundError(error: unknown): error is ManifestNotFoundError {
	return (
		error instanceof ManifestNotFoundError ||
		(typeof error === "object" &&
			error !== null &&
			"name" in error &&
			(error as { name?: string }).name === "ManifestNotFoundError")
	)
}
