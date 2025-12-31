import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseManifest } from "@/core/manifest/parse"
import type { Manifest, ValidatedDependency } from "@/core/manifest/types"
import { serializeManifest } from "@/core/manifest/write"
import type { AbsolutePath, AgentId, Alias } from "@/core/types/branded"

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
 * Load manifest from current working directory.
 * Optionally creates a new empty manifest if none exists.
 */
export async function loadManifestFromCwd(options: {
	createIfMissing: boolean
}): Promise<ManifestLoadResult> {
	const manifestPath = path.join(process.cwd(), "package.toml") as AbsolutePath
	let manifest: Manifest
	let created = false

	try {
		const contents = await readFile(manifestPath, "utf8")
		const parsed = parseManifest(contents, manifestPath, "cwd")
		if (!parsed.ok) {
			throw new Error(parsed.error.message)
		}

		manifest = parsed.value
	} catch (error) {
		if (isNotFound(error)) {
			if (!options.createIfMissing) {
				throw new ManifestNotFoundError(
					"package.toml not found in the current directory.",
				)
			}

			// Create empty manifest with proper typed Maps
			manifest = createEmptyManifest(manifestPath, "cwd")
			created = true
		} else {
			throw error
		}
	}

	return { created, manifest, manifestPath }
}

/**
 * Create an empty manifest with proper typed structures.
 */
export function createEmptyManifest(
	sourcePath: AbsolutePath,
	discoveredAt: "cwd" | "parent" | "home" | "sk-global",
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
): Promise<void> {
	const serialized = serializeManifest(manifest)
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
